import "server-only";
// Server-side reads shared by the textbook actions and queries: the NCERT
// catalogue (global reference table, 0139) and the (grade, subject) pairs a
// caller may map. Caller's own client; RLS decides the rows.
import type { TenantContext } from "@/lib/auth/types";
import type { createClient } from "@/lib/supabase/server";
import type { CatalogueBook, PairToMap } from "./ncert";

type Client = Awaited<ReturnType<typeof createClient>>;

const LEADERS = new Set(["owner", "principal", "admin"]);
export const CATALOGUE_COLUMNS = "code, class_level, subject, title, medium, chapters_count, book_url, chapter_pdf_pattern, verified";

export interface CatalogueRow {
  code: string;
  class_level: number | null;
  subject: string;
  title: string;
  medium: string;
  chapters_count: number;
  book_url: string;
  chapter_pdf_pattern: string;
  verified: boolean;
}

export function toCatalogueBook(r: CatalogueRow): CatalogueBook {
  return {
    code: r.code,
    classLevel: r.class_level,
    subject: r.subject,
    title: r.title,
    medium: r.medium,
    chaptersCount: r.chapters_count,
    bookUrl: r.book_url,
    chapterPdfPattern: r.chapter_pdf_pattern,
    verified: r.verified,
  };
}

/** The whole catalogue (391 rows, metadata only). */
export async function loadCatalogue(supabase: Client): Promise<CatalogueBook[]> {
  const { data, error } = await supabase.from("ncert_textbooks").select(CATALOGUE_COLUMNS).order("class_level").order("title");
  if (error) throw error;
  return (data ?? []).map(toCatalogueBook);
}

/** (grade, subject) pairs taught in the school (leaders) or by the caller (teacher), from subject_assignments. */
export async function mappablePairs(supabase: Client, ctx: TenantContext): Promise<PairToMap[]> {
  let query = supabase
    .from("subject_assignments")
    .select("subject_id, subjects(name), class_sections(grade_id, grades(code, display_name))")
    .eq("institution_id", ctx.institution.id);
  if (!LEADERS.has(ctx.membership.role)) {
    if (!ctx.membership.staffId) return [];
    query = query.eq("teacher_id", ctx.membership.staffId);
  }
  const { data, error } = await query;
  if (error) throw error;
  const pairs = new Map<string, PairToMap>();
  for (const row of data ?? []) {
    const subject = row.subjects as { name: string } | null;
    const section = row.class_sections as { grade_id: string; grades: { code: string; display_name: string } | null } | null;
    if (!subject || !section?.grades) continue;
    pairs.set(`${section.grade_id}:${row.subject_id}`, {
      gradeId: section.grade_id,
      gradeCode: section.grades.code,
      gradeName: section.grades.display_name,
      subjectId: row.subject_id,
      subjectName: subject.name,
    });
  }
  return [...pairs.values()];
}
