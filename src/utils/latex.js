export function stripUnsupportedPdfChars(text) {
  return text.replace(/[\u{1F300}-\u{1FAFF}]/gu, '');
}
