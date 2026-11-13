import "server-only";
// Textbook reads (0139): a school's (grade, subject) books with chapter
// links, unit -> chapter links, and the settings view. NCERT entries are
// links to ncert.nic.in only (verified books: one official PDF per chapter;
// unverified: the official book page). Caller's client; RLS: every member
// reads the mapping, unit links follow grade+subject.
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { getExtractionStatus } from "@/modules/content/queries";
import type { ExtractionSummary } from "@/modules/content/schemas";
import { CATALOGUE_COLUMNS, loadCatalogue, mappablePairs, toCatalogueBook, type CatalogueRow } from "./catalogue";
import { chapterLinks, classNumberFromGrade, type CatalogueBook } from "./ncert";

type Client = Awaited<ReturnType<typeof createClient>>;

export interface ChapterView {
  no: number;
  title: string | null;
  url: string | null;
  kind: "pdf" | "page" | "none";
}

export interface BookView {
  id: string;
  gradeId: string;
  subjectId: string;
  source: "ncert" | "custom";
  title: string;
  /** "NCERT · Class 6 · English" or the custom publisher. */
  subtitle: string | null;
  bookUrl: string | null;
  /** The school's own link beside an NCERT book's official one (custom books use bookUrl for theirs). */
  schoolUrl: string | null;
  /** The school's uploaded PDF (open it through textbook.file.readUrl). */
  file: { name: string; sizeBytes: number } | null;
  verified: boolean;
  code: string | null;
  chapters: ChapterView[];
  /** 0147 rights metadata; NCERT rows are always link_only. */
  meta: { edition: string | null; publicationYear: number | null; isbn: string | null; board: string | null; rightsStatus: string; permittedUse: string | null };
}

interface MappingRow {
  id: string;
  grade_id: string;
  subject_id: string;
  ncert_code: string | null;
  custom_title: string | null;
  custom_publisher: string | null;
  custom_url: string | null;
  custom_chapters: number | null;
  school_url: string | null;
  chapter_titles: unknown;
  position: number;
  edition: string | null;
  publication_year: number | null;
  isbn: string | null;
  board: string | null;
  rights_status: string;
  permitted_use: string | null;
  ncert_textbooks: CatalogueRow | null;
  file?: BookView["file"];
}

const MAPPING_COLUMNS = `id, grade_id, subject_id, ncert_code, custom_title, custom_publisher, custom_url, custom_chapters, school_url, chapter_titles, position, edition, publication_year, isbn, board, rights_status, permitted_use, ncert_textbooks(${CATALOGUE_COLUMNS})`;

const metaOf = (row: MappingRow): BookView["meta"] => ({ edition: row.edition, publicationYear: row.publication_year, isbn: row.isbn, board: row.board, rightsStatus: row.rights_status, permittedUse: row.permitted_use });

function toBookView(row: MappingRow): BookView {
  const titles = (row.chapter_titles && typeof row.chapter_titles === "object" ? row.chapter_titles : {}) as Record<string, string>;
  if (row.ncert_textbooks) {
    const b: CatalogueBook = toCatalogueBook(row.ncert_textbooks);
    return {
      id: row.id,
      gradeId: row.grade_id,
      subjectId: row.subject_id,
      source: "ncert",
      title: b.title,
      subtitle: ["NCERT", b.classLevel ? `Class ${b.classLevel}` : "Classes 11-12", b.medium].join(" · "),
      bookUrl: b.bookUrl,
      schoolUrl: row.school_url,
      file: row.file ?? null,
      verified: b.verified,
      code: b.code,
      meta: metaOf(row),
      chapters: chapterLinks(b).map((c) => ({ ...c, title: titles[String(c.no)] ?? null })),
    };
  }
  return {
    id: row.id,
    gradeId: row.grade_id,
    subjectId: row.subject_id,
    source: "custom",
    title: row.custom_title ?? "Textbook",
    subtitle: row.custom_publisher,
    bookUrl: row.custom_url,
    schoolUrl: row.school_url,
    file: row.file ?? null,
    verified: false,
    code: null,
    meta: metaOf(row),
    chapters: Array.from({ length: row.custom_chapters ?? 0 }, (_, i) => ({
      no: i + 1,
      title: titles[String(i + 1)] ?? null,
      url: row.custom_url,
      kind: row.custom_url ? ("page" as const) : ("none" as const),
    })),
  };
}

async function mappingRows(supabase: Client, ctx: TenantContext, filter: { gradeIds?: string[]; ids?: string[] }): Promise<MappingRow[]> {
  let q = supabase.from("subject_textbooks").select(MAPPING_COLUMNS).eq("institution_id", ctx.institution.id);
  if (filter.gradeIds) q = q.in("grade_id", filter.gradeIds);
  if (filter.ids) q = q.in("id", filter.ids);
  const { data, error } = await q.order("position").order("created_at");
  if (error) throw error;
  const rows = (data ?? []) as unknown as MappingRow[];
  if (rows.length === 0) return rows;
  // The school's PDFs (RLS: the same people who read the book's class files); newest live copy wins.
  const { data: docs, error: docError } = await supabase
    .from("documents")
    .select("entity_id, file_name, size_bytes")
    .eq("institution_id", ctx.institution.id)
    .eq("entity_type", "subject_textbook")
    .eq("status", "active")
    .in("entity_id", rows.map((r) => r.id))
    .order("created_at");
  if (docError) throw docError;
  const files = new Map((docs ?? []).map((d) => [d.entity_id, { name: d.file_name, sizeBytes: d.size_bytes }]));
  return rows.map((r) => ({ ...r, file: files.get(r.id) ?? null }));
}

/** One grade's books keyed by subject id. */
export async function textbooksForGrade(ctx: TenantContext, gradeId: string): Promise<Record<string, BookView[]>> {
  const supabase = await createClient();
  const out: Record<string, BookView[]> = {};
  for (const row of await mappingRows(supabase, ctx, { gradeIds: [gradeId] })) (out[row.subject_id] ??= []).push(toBookView(row));
  return out;
}

/** The section's grade and its books keyed by subject id (RLS: any member; another family's section reads as no grade). */
export async function textbooksForSection(ctx: TenantContext, classSectionId: string): Promise<{ gradeId: string | null; bySubject: Record<string, BookView[]> }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("class_sections").select("grade_id").eq("id", classSectionId).eq("institution_id", ctx.institution.id).maybeSingle();
  if (error) throw error;
  if (!data) return { gradeId: null, bySubject: {} };
  return { gradeId: data.grade_id, bySubject: await textbooksForGrade(ctx, data.grade_id) };
}

/** A student's (own or linked child's) active section grade and its books; RLS decides visibility. */
export async function textbooksForStudent(ctx: TenantContext, studentId: string): Promise<{ gradeId: string | null; bySubject: Record<string, BookView[]> }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? textbooksForSection(ctx, data.class_section_id) : { gradeId: null, bySubject: {} };
}

export interface UnitChapterView {
  textbookId: string;
  bookTitle: string;
  chapterNo: number;
  chapterTitle: string | null;
  url: string | null;
  kind: ChapterView["kind"];
}

/** Unit id -> its linked chapter (RLS: staff, or students/guardians of that grade+subject). */
export async function unitChapters(ctx: TenantContext, unitIds: string[]): Promise<Record<string, UnitChapterView>> {
  if (unitIds.length === 0) return {};
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("curriculum_unit_chapters")
    .select("curriculum_unit_id, subject_textbook_id, chapter_no")
    .eq("institution_id", ctx.institution.id)
    .in("curriculum_unit_id", unitIds);
  if (error) throw error;
  const links = data ?? [];
  if (links.length === 0) return {};
  const books = new Map((await mappingRows(supabase, ctx, { ids: [...new Set(links.map((l) => l.subject_textbook_id))] })).map((r) => [r.id, toBookView(r)]));
  const out: Record<string, UnitChapterView> = {};
  for (const l of links) {
    const book = books.get(l.subject_textbook_id);
    if (!book) continue;
    const chapter = book.chapters.find((c) => c.no === l.chapter_no);
    out[l.curriculum_unit_id] = {
      textbookId: book.id,
      bookTitle: book.title,
      chapterNo: l.chapter_no,
      chapterTitle: chapter?.title ?? null,
      url: chapter?.url ?? book.bookUrl,
      kind: chapter?.kind ?? (book.bookUrl ? "page" : "none"),
    };
  }
  return out;
}

export interface SettingsSubject {
  subjectId: string;
  subjectName: string;
  books: BookView[];
}
export interface SettingsGrade {
  gradeId: string;
  gradeName: string;
  classLevel: number | null;
  subjects: SettingsSubject[];
}
export interface CatalogueOption {
  code: string;
  title: string;
  subject: string;
  medium: string;
  verified: boolean;
}

/** The Textbooks settings view: every (grade, subject) the caller may map (leaders all, teachers their own) with its books, plus catalogue options per class. */
export async function textbookSettings(ctx: TenantContext): Promise<{ grades: SettingsGrade[]; catalogue: Record<string, CatalogueOption[]> }> {
  const supabase = await createClient();
  const [pairs, catalogue] = await Promise.all([mappablePairs(supabase, ctx), loadCatalogue(supabase)]);
  const rows = pairs.length ? await mappingRows(supabase, ctx, { gradeIds: [...new Set(pairs.map((p) => p.gradeId))] }) : [];
  const { data: grades, error } = pairs.length
    ? await supabase.from("grades").select("id, sort_key").in("id", [...new Set(pairs.map((p) => p.gradeId))])
    : { data: [], error: null };
  if (error) throw error;
  const sortKey = new Map((grades ?? []).map((g) => [g.id, g.sort_key]));

  const byGrade = new Map<string, SettingsGrade>();
  for (const p of pairs) {
    const grade = byGrade.get(p.gradeId) ?? {
      gradeId: p.gradeId,
      gradeName: p.gradeName,
      classLevel: classNumberFromGrade({ code: p.gradeCode, displayName: p.gradeName }),
      subjects: [],
    };
    grade.subjects.push({
      subjectId: p.subjectId,
      subjectName: p.subjectName,
      books: rows.filter((r) => r.grade_id === p.gradeId && r.subject_id === p.subjectId).map(toBookView),
    });
    byGrade.set(p.gradeId, grade);
  }
  const levels = new Set([...byGrade.values()].map((g) => g.classLevel).filter((l): l is number => l !== null));
  const options: Record<string, CatalogueOption[]> = {};
  for (const b of catalogue) {
    if (b.classLevel === null || !levels.has(b.classLevel)) continue;
    (options[String(b.classLevel)] ??= []).push({ code: b.code, title: b.title, subject: b.subject, medium: b.medium, verified: b.verified });
  }
  return {
    grades: [...byGrade.values()]
      .sort((a, b) => (sortKey.get(a.gradeId) ?? 0) - (sortKey.get(b.gradeId) ?? 0))
      .map((g) => ({ ...g, subjects: g.subjects.sort((a, b) => a.subjectName.localeCompare(b.subjectName)) })),
    catalogue: options,
  };
}

/** The newest reading per school-uploaded book (RLS hides it while the book's rights do not allow stored text). */
export async function extractionStates(ctx: TenantContext, bookIds: string[]): Promise<Record<string, ExtractionSummary>> {
  const rows = await Promise.all(bookIds.map(async (id) => [id, await getExtractionStatus(ctx, { subjectTextbookId: id })] as const));
  return Object.fromEntries(rows.filter((r): r is readonly [string, ExtractionSummary] => r[1] !== null));
}

export interface SearchableBook {
  id: string;
  title: string;
  gradeId: string;
  subjectId: string;
  /** "VI · Science" */
  label: string;
}

/** Books whose text has been read (any chunks) and the caller may see; RLS on content_extractions scopes staff and the book's students/guardians. */
export async function searchableBooks(ctx: TenantContext): Promise<SearchableBook[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("content_extractions")
    .select("subject_textbook_id, subject_textbooks!inner(id, grade_id, subject_id, custom_title, grades(code), subjects(name))")
    .eq("institution_id", ctx.institution.id)
    .in("status", ["done", "partial"]);
  if (error) throw error;
  const seen = new Map<string, SearchableBook>();
  for (const row of data ?? []) {
    const b = row.subject_textbooks as unknown as { id: string; grade_id: string; subject_id: string; custom_title: string | null; grades: { code: string } | null; subjects: { name: string } | null } | null;
    if (!b || seen.has(b.id)) continue;
    seen.set(b.id, { id: b.id, title: b.custom_title ?? "Textbook", gradeId: b.grade_id, subjectId: b.subject_id, label: `${b.grades?.code ?? "?"} · ${b.subjects?.name ?? ""}` });
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label) || a.title.localeCompare(b.title));
}

export interface ReviewChunk {
  id: string;
  chapterNo: number | null;
  heading: string | null;
  pageFrom: number;
  pageTo: number;
  body: string;
  editedAt: string | null;
}

export const CHUNK_PAGE_SIZE = 15;

/** One page of a book's read text in page order (RLS: staff of the school), plus its chapter numbers. */
export async function bookChunks(ctx: TenantContext, bookId: string, opts: { chapter?: number | "none"; page: number }): Promise<{ chunks: ReviewChunk[]; total: number; chapters: number[] }> {
  const supabase = await createClient();
  let q = supabase
    .from("content_chunks")
    .select("id, chapter_no, heading, page_from, page_to, body, edited_at", { count: "exact" })
    .eq("institution_id", ctx.institution.id)
    .eq("subject_textbook_id", bookId)
    .order("page_from")
    .order("id");
  if (opts.chapter === "none") q = q.is("chapter_no", null);
  else if (opts.chapter) q = q.eq("chapter_no", opts.chapter);
  const from = (opts.page - 1) * CHUNK_PAGE_SIZE;
  const [{ data, count, error }, { data: nos, error: nosError }] = await Promise.all([
    q.range(from, from + CHUNK_PAGE_SIZE - 1),
    supabase.from("content_chunks").select("chapter_no").eq("institution_id", ctx.institution.id).eq("subject_textbook_id", bookId).not("chapter_no", "is", null).limit(5000),
  ]);
  // PGRST103: a page past the last row reads as empty.
  if (error && error.code !== "PGRST103") throw error;
  if (nosError) throw nosError;
  return {
    chunks: (data ?? []).map((r) => ({ id: r.id, chapterNo: r.chapter_no, heading: r.heading, pageFrom: r.page_from, pageTo: r.page_to, body: r.body, editedAt: r.edited_at })),
    total: count ?? 0,
    chapters: [...new Set((nos ?? []).map((r) => r.chapter_no as number))].sort((a, b) => a - b),
  };
}

/** A book's title and grade/subject label for page headers; null when the caller cannot see it. */
export async function bookHeader(ctx: TenantContext, bookId: string): Promise<{ title: string; label: string; ncert: boolean } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subject_textbooks")
    .select("custom_title, ncert_code, grades(code), subjects(name)")
    .eq("id", bookId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const grade = data.grades as { code: string } | null;
  const subject = data.subjects as { name: string } | null;
  return { title: data.custom_title ?? "Textbook", label: `${grade?.code ?? ""} · ${subject?.name ?? ""}`, ncert: data.ncert_code !== null };
}
