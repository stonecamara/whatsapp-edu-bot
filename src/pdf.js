import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { generatePdfLesson } from './ai.js';

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

function writePdf(filePath, { title, subtitle, content }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.font('Helvetica-Bold').fontSize(20).text(title);
    doc.moveDown(0.2);
    doc.font('Helvetica').fontSize(12).fillColor('#444').text(subtitle);
    doc.moveDown();
    doc.fillColor('#111');

    for (const block of content.split('\n')) {
      const line = block.trim();
      if (!line) {
        doc.moveDown(0.5);
      } else if (line.startsWith('#')) {
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(14).text(line.replace(/^#+\s*/, ''));
      } else {
        doc.font('Helvetica').fontSize(11).text(line, { lineGap: 3 });
      }
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}
