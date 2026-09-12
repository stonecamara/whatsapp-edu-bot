import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { generatePdfLesson, generateQuiz } from './ai.js';

let latexUtils;
const answerLetters = ['A', 'B', 'C', 'D'];

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

export async function createQuizPdf({ phone, subject, topic, classLevel, context, quiz }) {
  const quizData = normalizeQuizForPdf(quiz || await generateQuiz({ subject, topic, classLevel, context }));
  const tmpDir = process.env.TMP_DIR || 'tmp';
  fs.mkdirSync(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `quiz-${phone}-${Date.now()}.pdf`);

  await writeQuizPdf(filePath, {
    title: `Fiche quiz - ${subject}`,
    subtitle: topic,
    quiz: quizData
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
  writeHeader(doc, title, subtitle);

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

async function writeQuizPdf(filePath, { title, subtitle, quiz }) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  const stream = fs.createWriteStream(filePath);
  const finished = new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  doc.pipe(stream);
  writeHeader(doc, title, subtitle);

  try {
    await writeSectionTitle(doc, 'Rappel rapide');
    for (const item of quiz.recap) {
      await writeMathAwareLine(doc, `- ${item}`, { fontSize: 10.5, indent: 10 });
    }

    await writeSectionTitle(doc, 'Quiz');
    for (const [index, question] of quiz.questions.entries()) {
      await writeQuestionBlock(doc, question, index);
    }

    doc.addPage();
    writeHeader(doc, 'Corrige', quiz.title || subtitle);
    for (const [index, question] of quiz.questions.entries()) {
      await writeCorrectionBlock(doc, question, index);
    }

    doc.end();
    await finished;
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

async function writeQuestionBlock(doc, question, index) {
  ensureSpace(doc, 110);
  if (index > 0) drawDivider(doc);
  doc.moveDown(0.35);
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#111').text(`Question ${index + 1}`, doc.page.margins.left, doc.y, {
    width: availableTextWidth(doc)
  });
  await writeMathAwareLine(doc, question.question, { fontSize: 10.8, bold: true, lineGap: 3 });
  doc.moveDown(0.15);

  for (const [optionIndex, option] of question.options.entries()) {
    await writeOptionLine(doc, answerLetters[optionIndex], option);
  }
  doc.moveDown(0.4);
}

async function writeCorrectionBlock(doc, question, index) {
  ensureSpace(doc, 72);
  const correct = normalizeCorrectIndex(question.correct);
  const answer = question.options[correct] || '';
  doc.font('Helvetica-Bold').fontSize(10.8).fillColor('#111').text(`${index + 1}. Reponse ${answerLetters[correct]}`, doc.page.margins.left, doc.y, {
    width: availableTextWidth(doc)
  });
  if (answer) await writeAnswerValue(doc, answer);
  if (question.explanation) await writeMathAwareLine(doc, question.explanation, { fontSize: 10.2, indent: 14, lineGap: 2 });
  doc.moveDown(0.35);
}

async function writeOptionLine(doc, letter, option) {
  const math = await singleMathSegment(option);
  if (math) {
    await writeCompactMathLine(doc, `${letter}.`, math.value, { indent: 14, labelWidth: 28 });
    return;
  }

  await writeMathAwareLine(doc, `${letter}. ${option}`, { fontSize: 10.4, indent: 14, lineGap: 2 });
}

async function writeAnswerValue(doc, answer) {
  const math = await singleMathSegment(answer);
  if (math) {
    await writeCompactMathLine(doc, '', math.value, { indent: 14, labelWidth: 0 });
    return;
  }

  await writeMathAwareLine(doc, answer, { fontSize: 10.4, indent: 14, lineGap: 2 });
}

function writeHeader(doc, title, subtitle) {
  doc.font('Helvetica-Bold').fontSize(20).fillColor('#111').text(title, doc.page.margins.left, doc.y, {
    width: availableTextWidth(doc)
  });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(12).fillColor('#444').text(subtitle, doc.page.margins.left, doc.y, {
    width: availableTextWidth(doc)
  });
  doc.moveDown();
  doc.fillColor('#111');
  doc.x = doc.page.margins.left;
}

async function writeSectionTitle(doc, title) {
  ensureSpace(doc, 44);
  doc.moveDown(0.45);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text(title, doc.page.margins.left, doc.y, {
    width: availableTextWidth(doc)
  });
  drawDivider(doc);
  doc.moveDown(0.25);
}

function drawDivider(doc) {
  const y = doc.y + 4;
  doc
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.width - doc.page.margins.right, y)
    .strokeColor('#dddddd')
    .lineWidth(0.5)
    .stroke();
  doc.fillColor('#111');
  doc.y = y + 6;
}

async function writeMathAwareLine(doc, line, { fontSize = 11, bold = false, indent = 0, lineGap = 3 } = {}) {
  const { splitLatexSegments, stripUnsupportedPdfChars } = await getLatexUtils();
  const cleanLine = stripUnsupportedPdfChars(String(line || '').trim());
  if (!cleanLine) return;

  const x = doc.page.margins.left + indent;
  const width = doc.page.width - doc.page.margins.right - x;
  const segments = splitLatexSegments(cleanLine);
  if (!segments.some((segment) => segment.type === 'math')) {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#111').text(cleanLine, x, doc.y, { lineGap, width });
    return;
  }

  for (const segment of segments) {
    if (segment.type === 'text') {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#111').text(segment.value, x, doc.y, { lineGap, width });
    } else {
      await writeEquation(doc, segment.value, { display: segment.display });
    }
  }
}

async function singleMathSegment(line) {
  const { splitLatexSegments, stripUnsupportedPdfChars } = await getLatexUtils();
  const cleanLine = stripUnsupportedPdfChars(String(line || '').trim());
  const segments = splitLatexSegments(cleanLine);
  return segments.length === 1 && segments[0].type === 'math' ? segments[0] : null;
}

async function writeCompactMathLine(doc, label, latex, { indent = 0, labelWidth = 28, maxHeight = 22 } = {}) {
  ensureSpace(doc, maxHeight + 10);
  const { renderLatexToPng } = await getLatexUtils();
  const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x = doc.page.margins.left + indent;
  const y = doc.y;

  if (label) {
    doc.font('Helvetica').fontSize(10.4).fillColor('#111').text(label, x, y, {
      width: labelWidth,
      lineBreak: false
    });
  }

  try {
    const rendered = await renderLatexToPng(latex, { display: false, maxWidth: 480 });
    let height = maxHeight;
    let width = rendered.width * (height / rendered.height);
    const maxWidth = availableWidth - indent - labelWidth;
    if (width > maxWidth) {
      width = maxWidth;
      height = rendered.height * (width / rendered.width);
    }

    doc.image(rendered.buffer, x + labelWidth, y - 4, { width });
    doc.x = doc.page.margins.left;
    doc.y = y + Math.max(16, height) + 4;
  } catch {
    doc.font('Helvetica').fontSize(10.4).fillColor('#333').text(`${label} ${latex}`.trim(), x, y, { lineGap: 2 });
    doc.fillColor('#111');
    doc.x = doc.page.margins.left;
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

function normalizeQuizForPdf(quiz) {
  const questions = Array.isArray(quiz?.questions) ? quiz.questions : [];
  return {
    title: String(quiz?.title || 'Quiz de revision').trim(),
    recap: Array.isArray(quiz?.recap)
      ? quiz.recap.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
      : [],
    questions: questions.map(normalizeQuestionForPdf).filter(Boolean).slice(0, 5)
  };
}

function normalizeQuestionForPdf(question) {
  const options = Array.isArray(question?.options)
    ? question.options.map((option) => String(option || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  if (!question?.question || options.length !== 4) return null;

  return {
    question: String(question.question).trim(),
    options,
    correct: normalizeCorrectIndex(question.correct),
    explanation: String(question.explanation || '').trim()
  };
}

function normalizeCorrectIndex(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 3) return value;
  const text = String(value || '').trim().toUpperCase();
  if (['A', '0'].includes(text)) return 0;
  if (['B', '1'].includes(text)) return 1;
  if (['C', '2'].includes(text)) return 2;
  if (['D', '3'].includes(text)) return 3;
  return 0;
}

function availableTextWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
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
