const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "sgt", "col", "gen", "rep",
  "sen", "gov", "lt", "maj", "capt", "st", "mt", "etc", "co", "inc", "ltd",
  "dept", "vs", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep",
  "sept", "oct", "nov", "dec",
]);

const MAX_CHARS = 200;
const TRAILING = new Set(['"', "'", "”", "’", ")", "]", "}"]);

function wordBeforePeriod(text, periodIndex) {
  let start = periodIndex - 1;
  while (start >= 0 && /[A-Za-z]/.test(text[start])) start -= 1;
  return text.slice(start + 1, periodIndex);
}

function isAbbreviation(text, periodIndex) {
  const word = wordBeforePeriod(text, periodIndex).toLowerCase();
  if (!word) return false;
  if (word.length === 1) return true;
  return ABBREVIATIONS.has(word);
}

function splitSentences(text) {
  const sentences = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c !== "." && c !== "!" && c !== "?" && c !== "…") continue;

    if (c === ".") {
      if (text[i + 1] === ".") {
        while (text[i + 1] === ".") i += 1;
      } else if (isAbbreviation(text, i) || /[A-Za-z0-9]/.test(text[i + 1] || "")) {
        continue;
      }
    }

    let end = i + 1;
    while (end < text.length && TRAILING.has(text[end])) end += 1;
    const sentence = text.slice(start, end).trim();
    if (sentence) sentences.push(sentence);

    let next = end;
    while (next < text.length && /\s/.test(text[next])) next += 1;
    start = next;
    i = next - 1;
  }

  const rest = text.slice(start).trim();
  if (rest) sentences.push(rest);
  return sentences;
}

function splitLong(sentence) {
  const parts = [];
  let rest = sentence.trim();

  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    let cut = -1;
    for (const sep of [";", ":", ",", "—", "–", " "]) {
      const idx = window.lastIndexOf(sep);
      if (idx >= 40) {
        cut = idx + 1;
        break;
      }
    }
    if (cut < 0) cut = MAX_CHARS;
    const piece = rest.slice(0, cut).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

/**
 * Split text into speakable chunks.
 * gapBefore is seconds of silence to insert before the chunk.
 * @param {string} text
 * @returns {{ text: string, gapBefore: number }[]}
 */
export function splitForSpeech(text) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const chunks = [];
  const paragraphs = normalized.split(/\n{2,}/);

  for (const paragraph of paragraphs) {
    const flat = paragraph.replace(/\s*\n\s*/g, " ").replace(/[ \t]{2,}/g, " ").trim();
    if (!flat) continue;

    const sentences = splitSentences(flat);
    let firstInParagraph = true;

    for (const sentence of sentences) {
      const pieces = splitLong(sentence);
      for (let p = 0; p < pieces.length; p += 1) {
        const piece = pieces[p];
        if (!/[A-Za-z0-9]/.test(piece)) continue;

        let gapBefore = 0;
        if (chunks.length > 0) {
          if (p > 0) gapBefore = 0;
          else if (firstInParagraph) gapBefore = 0.18;
          else gapBefore = 0.05;
        }

        chunks.push({ text: piece, gapBefore });
        firstInParagraph = false;
      }
    }
  }

  return chunks;
}
