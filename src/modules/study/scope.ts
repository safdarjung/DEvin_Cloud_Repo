// Study with AI on a chosen scope (0140 item 8). The scope is ids only
// (subjects, whole books, chapters, units, files, a short goal line); the
// model context is rebuilt by the server from the database on every turn.
// buildScopeContext is pure: anything not in `allowed` (another grade's book
// or unit, another student's file, another school's id) is dropped, the
// result is deterministic and capped in size.
import { z } from "zod";

const id = z.string().uuid();

export const SCOPE_MAX_UNITS = 12;
export const SCOPE_MAX_FILES = 3;
export const SCOPE_MAX_CHARS = 6000;
const OUTLINE_MAX = 300;

export const StudyScopeSchema = z
  .object({
    subjectIds: z.array(id).min(1).max(4),
    /** "Whole book". */
    textbookIds: z.array(id).max(6).optional(),
    /** "These chapters". */
    chapters: z.array(z.object({ textbookId: id, chapterNo: z.number().int().min(1).max(99) }).strict()).max(40).optional(),
    /** "These units". */
    unitIds: z.array(id).max(24).optional(),
    fileIds: z.array(id).max(SCOPE_MAX_FILES).optional(),
    goal: z.string().trim().max(200).optional(),
  })
  .strict();
export type StudyScope = z.infer<typeof StudyScopeSchema>;

export interface ScopeAllowed {
  subjects: { id: string; name: string }[];
  books: { id: string; subjectId: string; title: string; ncert: boolean; chapterCount: number; chapterTitles: Record<string, string> }[];
  /** Units of the student's own grade and subjects, in curriculum order; `chapter` from curriculum_unit_chapters. */
  units: { id: string; subjectId: string; title: string; description: string | null; chapter: { textbookId: string; no: number } | null }[];
  files: { id: string; title: string; subjectId: string | null; readable: boolean }[];
}

export interface UnitProgress {
  /** 0..100, or null with no answered questions. */
  accuracy: number | null;
  minutes: number;
  lastStudied: string | null;
}

export interface ScopeContext {
  title: string;
  subjectIds: string[];
  /** Whole books and chapters that survived the check. */
  textbookIds: string[];
  chapters: { textbookId: string; chapterNo: number }[];
  unitIds: string[];
  fileIds: string[];
  lines: string[];
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The units a scope covers, in curriculum order: chosen units, units of chosen chapters, units of whole books (a book with no mapped chapter covers its subject's units). */
function scopedUnits(scope: StudyScope, allowed: ScopeAllowed, subjectIds: Set<string>, bookIds: Set<string>, chapters: Set<string>): ScopeAllowed["units"] {
  const unitIds = new Set(scope.unitIds ?? []);
  const wholeBookSubjects = new Set(allowed.books.filter((b) => bookIds.has(b.id) && !allowed.units.some((u) => u.chapter?.textbookId === b.id)).map((b) => b.subjectId));
  return allowed.units.filter(
    (u) =>
      subjectIds.has(u.subjectId) &&
      (unitIds.has(u.id) ||
        (u.chapter && (bookIds.has(u.chapter.textbookId) || chapters.has(`${u.chapter.textbookId}:${u.chapter.no}`))) ||
        wholeBookSubjects.has(u.subjectId)),
  );
}

export function buildScopeContext(input: {
  scope: StudyScope;
  allowed: ScopeAllowed;
  progress: Readonly<Record<string, UnitProgress>>;
  teacherMaterials: readonly { unitId: string; title: string }[];
}): { ok: true; context: ScopeContext } | { ok: false; reason: string } {
  const { scope, allowed, progress } = input;
  const subjects = allowed.subjects.filter((s) => scope.subjectIds.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (subjects.length === 0) return { ok: false, reason: "Pick a subject of your own class." };
  const subjectIds = new Set(subjects.map((s) => s.id));
  const books = allowed.books.filter((b) => subjectIds.has(b.subjectId)).sort((a, b) => a.title.localeCompare(b.title));
  const bookById = new Map(books.map((b) => [b.id, b]));
  const wholeBooks = new Set((scope.textbookIds ?? []).filter((b) => bookById.has(b)));
  const chapters = new Set(
    (scope.chapters ?? [])
      .filter((c) => {
        const book = bookById.get(c.textbookId);
        return book && !wholeBooks.has(c.textbookId) && c.chapterNo <= book.chapterCount;
      })
      .map((c) => `${c.textbookId}:${c.chapterNo}`),
  );
  const units = scopedUnits(scope, allowed, subjectIds, wholeBooks, chapters);
  const shownUnits = units.slice(0, SCOPE_MAX_UNITS);
  const files = allowed.files.filter((f) => (scope.fileIds ?? []).includes(f.id) && f.readable && (f.subjectId === null || subjectIds.has(f.subjectId))).slice(0, SCOPE_MAX_FILES);
  if (shownUnits.length === 0 && chapters.size === 0 && wholeBooks.size === 0 && files.length === 0) {
    return { ok: false, reason: "Pick at least one book, chapter, unit or file." };
  }

  const lines: string[] = ["The student chose this to study (checked by the school system; ids not shown):"];
  if (scope.goal) lines.push(`What the student wants from this: ${scope.goal}`);
  for (const subject of subjects) {
    lines.push(`Subject: ${subject.name}`);
    for (const book of books.filter((b) => b.subjectId === subject.id && (wholeBooks.has(b.id) || [...chapters].some((c) => c.startsWith(`${b.id}:`))))) {
      lines.push(
        `Book: ${book.title}${book.ncert ? " (NCERT). You have NOT read this book: NCERT books are links only." : " (the school's book). You have not read it."}`,
      );
      const nos = wholeBooks.has(book.id)
        ? Array.from({ length: book.chapterCount }, (_, i) => i + 1)
        : [...chapters].filter((c) => c.startsWith(`${book.id}:`)).map((c) => Number(c.split(":")[1])).sort((a, b) => a - b);
      lines.push(`Chapters: ${nos.map((n) => (book.chapterTitles[String(n)] ? `${n} (${book.chapterTitles[String(n)]})` : String(n))).join(", ")}`);
    }
    for (const u of shownUnits.filter((x) => x.subjectId === subject.id)) {
      const chapter = u.chapter && bookById.get(u.chapter.textbookId) ? ` [chapter ${u.chapter.no}]` : "";
      lines.push(`Unit: ${u.title}${chapter}. Outline: ${clip(u.description ?? "(no outline written; use the unit title)", OUTLINE_MAX)}`);
      const p = progress[u.id];
      if (p && (p.accuracy !== null || p.minutes > 0)) {
        lines.push(`  The student's own practice on it: ${p.accuracy === null ? "no quiz answers yet" : `${p.accuracy}% correct`}, ${p.minutes} min studied.`);
      }
      const shared = input.teacherMaterials.filter((m) => m.unitId === u.id).map((m) => m.title);
      if (shared.length) lines.push(`  Teacher-shared material: ${[...new Set(shared)].slice(0, 3).join("; ")}`);
    }
  }
  if (units.length > shownUnits.length) lines.push(`(${units.length - shownUnits.length} more units in this scope are not listed.)`);
  for (const f of files) lines.push(`File the student picked: "${f.title}". Read it only with the readScopeFile tool; until then you have not seen it.`);

  let used = 0;
  const capped = lines.filter((l) => (used += l.length + 1) <= SCOPE_MAX_CHARS);
  const firstSubject = subjects[0]!.name;
  const label = shownUnits.length ? shownUnits.slice(0, 3).map((u) => u.title).join(", ") : [...chapters].length ? `${chapters.size} chapter${chapters.size === 1 ? "" : "s"}` : "whole book";
  return {
    ok: true,
    context: {
      title: clip(`${firstSubject}: ${label}`, 120),
      subjectIds: subjects.map((s) => s.id),
      textbookIds: books.filter((b) => wholeBooks.has(b.id)).map((b) => b.id),
      chapters: [...chapters].sort().map((c) => ({ textbookId: c.split(":")[0]!, chapterNo: Number(c.split(":")[1]) })),
      unitIds: shownUnits.map((u) => u.id),
      fileIds: files.map((f) => f.id),
      lines: capped,
    },
  };
}

/** "3 of 12 chapters studied, weakest: Chapter 4" for a book, from unit progress. */
export function chapterSummary(book: ScopeAllowed["books"][number], units: ScopeAllowed["units"], progress: Readonly<Record<string, UnitProgress>>): { studied: number; total: number; weakest: number | null } {
  const byChapter = new Map<number, UnitProgress[]>();
  for (const u of units) if (u.chapter?.textbookId === book.id && progress[u.id]) byChapter.set(u.chapter.no, [...(byChapter.get(u.chapter.no) ?? []), progress[u.id]!]);
  const studied = [...byChapter].filter(([, ps]) => ps.some((p) => p.minutes > 0 || p.accuracy !== null));
  const scored = studied
    .map(([no, ps]) => ({ no, acc: ps.map((p) => p.accuracy).filter((a): a is number => a !== null) }))
    .filter((c) => c.acc.length)
    .map((c) => ({ no: c.no, acc: c.acc.reduce((a, b) => a + b, 0) / c.acc.length }))
    .sort((a, b) => a.acc - b.acc || a.no - b.no);
  return { studied: studied.length, total: book.chapterCount, weakest: scored[0]?.no ?? null };
}
