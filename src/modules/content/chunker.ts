// 0148 — page text -> searchable chunks (15-learning-exam-system-plan.md
// Phase 2). Pure, no imports: the content.extract job loads this under plain
// Node (scripts/jobs-run.ts), so relative imports only, never `@/`.

/** Rights a book needs before its text may be stored (0147 rights_status). */
export const EXTRACTABLE_RIGHTS = ["school_owned", "licensed", "open_licence"] as const;

export const CHUNK_TARGET_CHARS = 1500;
/** shortcut: fewer letters/digits than this = no text layer (a scan); tune if title-only pages get sent to OCR. */
export const MIN_TEXT_CHARS = 25;
/** content_chunks / content_extractions page cap (0148 checks). */
export const MAX_PDF_PAGES = 2000;
const HEADING_MAX = 200;
const HEADING_SCAN_LINES = 6;

export interface PageText {
  page: number;
  text: string;
}

/** Shape the 0148 RPCs read with jsonb_to_recordset (snake_case on purpose). */
export interface ChunkDraft {
  chapter_no: number | null;
  page_from: number;
  page_to: number;
  heading: string | null;
  body: string;
}

export interface ChapterState {
  chapterNo: number | null;
  heading: string | null;
}

export type ChapterTitles = Record<string, string>;

/** NCERT rows are link-only whatever the column says (0139 ruling); others need an allowing status. */
export function canExtractText(book: { rights_status: string; ncert_code: string | null }): boolean {
  return book.ncert_code === null && (EXTRACTABLE_RIGHTS as readonly string[]).includes(book.rights_status);
}

/** subject_textbooks.chapter_titles ({"1": "..."}) with non-string values dropped. */
export function chapterTitlesOf(raw: unknown): ChapterTitles {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string" && e[1].trim() !== ""));
}

export function cleanText(raw: string): string {
  return raw
    .toWellFormed()
    .replace(/\r\n?/g, "\n")
    // NUL is rejected by Postgres text; the rest is PDF noise.
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F\uFFFD]/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function needsOcr(text: string): boolean {
  return (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) < MIN_TEXT_CHARS;
}

function hardCut(text: string, max: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
  return out;
}

// Paragraphs, then lines, then sentences, then a hard cut: every piece <= max.
function pieces(text: string, max: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= max) {
      out.push(para);
      continue;
    }
    for (const line of para.split("\n")) {
      if (line.length <= max) {
        out.push(line);
        continue;
      }
      for (const sentence of line.split(/(?<=[.!?।])\s+/)) {
        out.push(...(sentence.length <= max ? [sentence] : hardCut(sentence, max)));
      }
    }
  }
  return out.filter((p) => p.trim() !== "");
}

export function splitLong(text: string, max = CHUNK_TARGET_CHARS): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = "";
  for (const piece of pieces(text, max)) {
    if (current && current.length + 1 + piece.length > max) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n${piece}` : piece;
  }
  if (current) out.push(current);
  return out;
}

const CHAPTER_LINE = /^(?:chapter|ch\.|unit|lesson|अध्याय|पाठ)\s*[-:]?\s*(\d{1,2})\b[\s.:\-–—]*(.*)$/iu;
const NUMBERED_LINE = /^(\d{1,2})[.)]?\s+(\S.*)$/u;

const comparable = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function sameTitle(line: string, title: string): boolean {
  const a = comparable(line);
  const b = comparable(title);
  return b.length >= 4 && (a === b || a.startsWith(`${b} `));
}

/** A chapter start in the first few lines: "Chapter N ...", or a line matching the school's own chapter titles. */
export function detectChapter(text: string, titles: ChapterTitles): ChapterState | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, HEADING_SCAN_LINES);
  const hasTitles = Object.keys(titles).length > 0;
  for (const line of lines) {
    const m = CHAPTER_LINE.exec(line);
    if (m) {
      const n = Number(m[1]);
      if (n < 1 || n > 99) continue;
      const heading = titles[String(n)] ?? (m[2].trim() || line);
      return { chapterNo: n, heading: heading.slice(0, HEADING_MAX) };
    }
    if (!hasTitles) continue;
    const numbered = NUMBERED_LINE.exec(line);
    if (numbered && titles[numbered[1]] && sameTitle(numbered[2], titles[numbered[1]])) {
      return { chapterNo: Number(numbered[1]), heading: titles[numbered[1]].slice(0, HEADING_MAX) };
    }
    for (const [n, title] of Object.entries(titles)) {
      if (sameTitle(line, title) && Number(n) >= 1 && Number(n) <= 99) return { chapterNo: Number(n), heading: title.slice(0, HEADING_MAX) };
    }
  }
  return null;
}

/** One or more chunks per non-empty page; the chapter carries forward until the next heading. */
export function chunkPages(pages: readonly PageText[], titles: ChapterTitles = {}, start: ChapterState = { chapterNo: null, heading: null }): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  let state = start;
  for (const { page, text: raw } of [...pages].sort((a, b) => a.page - b.page)) {
    const text = cleanText(raw);
    if (!text) continue;
    state = detectChapter(text, titles) ?? state;
    for (const body of splitLong(text)) {
      out.push({ chapter_no: state.chapterNo, page_from: page, page_to: page, heading: state.heading, body });
    }
  }
  return out;
}
