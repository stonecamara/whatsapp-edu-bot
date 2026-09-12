import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { generatePdfLesson } from './ai.js';

let latexUtils;

export async function createLessonPdf({ phone, subject, topic, classLevel, context }) {
  const content = await generatePdfLesson({ subject, topic, classLevel, context });
  const tmpDir = process.env.TMP_DIR || 'tmp';
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `fiche-${phone}-${Date.now()}.pdf`);

  await writePdf(filePath, {
    title: `Fiche - ${subject}`,
    subtitle: topic,
    content
  });

  return filePath;
}

async function writePdf(filePath, { title, subtitle, content }) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const stream = fs.createWriteStream(filePath);
  const finished = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  doc.pipe(stream);
  doc.font('Helvetica-Bold').fontSize(20).text(title);
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(12).fillColor('#444').text(subtitle);
  doc.moveDown();
  doc.fillColor('#111');

  try {
    const { stripUnsupportedPdfChars } = await getLatexUtils();
    for (const block of content.split('\n')) {
      const line = stripUnsupportedPdfChars(block.trim());
      if (!line) {
        doc.moveDown(0.5);
      } else if (line.startsWith('#')) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(14).text(line.replace(/^#+\s*/, ''));
      } else {
        await writeMathAwareLine(doc, line);
      }
    }

    doc.end();
    await finished;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

async function writeMathAwareLine(doc, line) {
  const { splitLatexSegments } = await getLatexUtils();
  const segments = splitLatexSegments(line);
  if (!segments.some((segment) => segment.type === 'math')) {
    doc.font('Helvetica').fontSize(11).text(line, { lineGap: 3 });
    return;
  }

  for (const segment of segments) {
    if (segment.type === 'text') {
      doc.font('Helvetica').fontSize(11).text(segment.value, { lineGap: 3 });
    } else {
      await writeEquation(doc, segment.value, segment.display);
    }
  }
}

async function writeEquation(doc, latex, display) {
  try {
    const { renderLatexToPng } = await getLatexUtils();
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const rendered = await renderLatexToPng(latex, { display, maxWidth: Math.floor(availableWidth * 2) });
    const width = Math.min(availableWidth, rendered.width / 2);
    const height = Math.max(18, rendered.height * (width / rendered.width));
    ensureSpace(doc, height + 16);

    const x = doc.page.margins.left + (availableWidth - width) / 2;
    doc.moveDown(0.25);
    doc.image(rendered.buffer, x, doc.y, { width });
    doc.y += height + 8;
  } catch {
    doc.font('Helvetica').fontSize(11).text(`$${latex}$`, { lineGap: 3 });
  }
}

async function getLatexUtils() {
  latexUtils ||= await import('./utils/latex.js');
  return latexUtils;
}

function ensureSpace(doc, neededHeight) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + neededHeight > bottom) {
    doc.addPage();
  }
}
