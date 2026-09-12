import sharp from 'sharp';
import { mathjax } from '@mathjax/src/js/mathjax.js';
import { TeX } from '@mathjax/src/js/input/tex.js';
import { SVG } from '@mathjax/src/js/output/svg.js';
import { liteAdaptor } from '@mathjax/src/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from '@mathjax/src/js/handlers/html.js';

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

const tex = new TeX();
const svg = new SVG({ fontCache: 'none' });
const html = mathjax.document('', { InputJax: tex, OutputJax: svg });
const renderCache = new Map();

export function stripUnsupportedPdfChars(text) {
  return text.replace(/[\u{1F300}-\u{1FAFF}]/gu, '');
}

export function splitLatexSegments(text) {
  const segments = [];
  let index = 0;
  let textStart = 0;

  while (index < text.length) {
    if (text.startsWith('$$', index) && !isEscaped(text, index)) {
      const end = findUnescaped(text, '$$', index + 2);
      if (end !== -1) {
        pushTextSegment(segments, text.slice(textStart, index));
        segments.push({ type: 'math', value: text.slice(index + 2, end).trim(), display: true });
        index = end + 2;
        textStart = index;
        continue;
      }
    }

    if (text[index] === '$' && !isEscaped(text, index)) {
      const end = findUnescaped(text, '$', index + 1);
      if (end !== -1) {
        pushTextSegment(segments, text.slice(textStart, index));
        segments.push({ type: 'math', value: text.slice(index + 1, end).trim(), display: false });
        index = end + 1;
        textStart = index;
        continue;
      }
    }

    index += 1;
  }

  pushTextSegment(segments, text.slice(textStart));
  return segments.filter((segment) => segment.value);
}

export async function renderLatexToPng(latex, { display = true, maxWidth = 900 } = {}) {
  const renderAsDisplay = true;
  const cacheKey = `${renderAsDisplay}:${maxWidth}:${latex}`;
  if (renderCache.has(cacheKey)) return renderCache.get(cacheKey);

  const node = html.convert(latex, { display: renderAsDisplay });
  const output = adaptor.outerHTML(node);
  const svgMarkup = extractSvg(output).replace(/currentColor/g, '#111111');
  const buffer = await sharp(Buffer.from(svgMarkup))
    .flatten({ background: '#ffffff' })
    .resize({ width: maxWidth, fit: 'inside' })
    .extend({ top: 18, bottom: 18, left: 24, right: 24, background: '#ffffff' })
    .png()
    .toBuffer();
  const metadata = await sharp(buffer).metadata();
  const rendered = {
    buffer,
    width: metadata.width || maxWidth,
    height: metadata.height || 48
  };
  renderCache.set(cacheKey, rendered);
  return rendered;
}

function pushTextSegment(segments, value) {
  const cleaned = value.replace(/\s+/g, ' ').trim().replace(/^[,;:]\s*/, '');
  if (/^[.,;:!?]+$/.test(cleaned)) return;
  if (cleaned) segments.push({ type: 'text', value: cleaned });
}

function findUnescaped(text, token, from) {
  let index = text.indexOf(token, from);
  while (index !== -1) {
    if (!isEscaped(text, index)) return index;
    index = text.indexOf(token, index + token.length);
  }
  return -1;
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function extractSvg(output) {
  const match = output.match(/<svg[\s\S]*?<\/svg>/);
  if (!match) throw new Error('MathJax SVG introuvable');
  const svgMarkup = match[0];
  if (svgMarkup.includes('xmlns=')) return svgMarkup;
  return svgMarkup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
}
