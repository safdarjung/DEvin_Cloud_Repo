import "server-only";
// Textbook reads (0139): a school's (grade, subject) books with chapter
// links, unit -> chapter links, and the settings view. NCERT entries are
// links to ncert.nic.in only (verified books: one official PDF per chapter;
// unverified: the official book page). Caller's client; RLS: every member
// reads the mapping, unit links follow grade+subject.
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
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
  verified: boolean;
  code: string | null;
  chapters: ChapterView[];
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
  chapter_titles: unknown;
  position: number;
  ncert_textbooks: CatalogueRow | null;
}

const MAPPING_COLUMNS = `id, grade_id, subject_id, ncert_code, custom_title, custom_publisher, custom_url, custom_chapters, chapter_titles, position, ncert_textbooks(${CATALOGUE_COLUMNS})`;

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
      verified: b.verified,
      code: b.code,
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
    verified: false,
    code: null,
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
  return (data ?? []) as unknown as MappingRow[];
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
