import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { generatePdfLesson, generateQuizSheet } from './ai.js';

let latexUtils;

export async function createLessonPdf({ phone, subject, topic, classLevel, context, content }) {
  const lessonContent = content || await generatePdfLesson({ subject, topic, classLevel, context });
  const tmpDir = process.env.TMP_DIR || 'tmp';
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `fiche-${phone}-${Date.now()}.pdf`);

  await writePdf(filePath, {
    title: `Fiche - ${subject}`,
    subtitle: topic,
    content: lessonContent
  });

  return filePath;
}

export async function createQuizPdf({ phone, subject, topic, classLevel, context, content }) {
  const quizContent = content || await generateQuizSheet({ subject, topic, classLevel, context });
  const tmpDir = process.env.TMP_DIR || 'tmp';
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `quiz-${phone}-${Date.now()}.pdf`);

  await writePdf(filePath, {
    title: `Fiche quiz - ${subject}`,
    subtitle: topic,
    content: quizContent
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
      await writeEquation(doc, segment.value, { display: segment.display });
    }
  }
}

async function writeEquation(doc, latex, { display }) {
  try {
    const { renderLatexToPng } = await getLatexUtils();
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    let width = Math.min(availableWidth, Math.max(80, availableWidth * equationWidthRatio(latex, display)));
    const rendered = await renderLatexToPng(latex, { display, maxWidth: Math.floor(width * 3) });
    let height = Math.max(14, rendered.height * (width / rendered.width));
    const maxHeight = display ? 62 : 34;
    if (height > maxHeight) {
      width *= maxHeight / height;
      height = maxHeight;
    }
    ensureSpace(doc, height + 18);

    const x = doc.page.margins.left + (availableWidth - width) / 2;
    doc.moveDown(display ? 0.45 : 0.25);
    doc.image(rendered.buffer, x, doc.y, { width });
    doc.y += height + 6;
    doc.moveDown(0.35);
  } catch {
    doc.font('Helvetica').fontSize(10).fillColor('#333').text(latex, { lineGap: 3 });
    doc.fillColor('#111');
  }
}

function equationWidthRatio(latex, display) {
  if (display) {
    if (latex.length <= 18) return 0.24;
    if (latex.length <= 36) return 0.34;
    return 0.46;
  }
  if (latex.length <= 12) return 0.14;
  if (latex.length <= 28) return 0.22;
  return 0.32;
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
