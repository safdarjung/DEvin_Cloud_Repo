import "server-only";
// Study studio sources, read under the caller's own RLS client. A student may
// use a unit of a subject taught in their own active section, a resource the
// school shared with their section, or pasted notes; a teacher any unit,
// resource or lesson plan their RLS lets them read. Only the source's own
// text is returned for the prompt: no student or staff records.
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { classWeakUnitsSource, fileSource, teacherUnitsSource, weakUnitsSource } from "@/modules/study/help-sources";
import { scopeSource } from "@/modules/study/scope-source";
import type { StudySource } from "@/modules/study/schemas";

export interface ResolvedSource {
  title: string;
  sourceLabel: string;
  lines: string[];
  gradeLabel: string | null;
  subjectName: string | null;
  subjectId: string | null;
  unitId: string | null;
  resourceId: string | null;
  /** 0140: the curriculum file the material is made from (file source). */
  sourceMaterialId?: string | null;
  /** 0140: units a revision pack targets. */
  focusUnitIds?: string[];
  /** 0140: bytes for the multimodal path, fetched under the caller's RLS. */
  file?: { bytes: Uint8Array; mime: string; fileName: string };
}

export type Client = Awaited<ReturnType<typeof createClient>>;
const notFound = (): never => {
  throw new AppError("not_found", "That source was not found.");
};

export async function names(supabase: Client, gradeId: string | null, subjectId: string | null) {
  const [grade, subject] = await Promise.all([
    gradeId ? supabase.from("grades").select("display_name").eq("id", gradeId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    subjectId ? supabase.from("subjects").select("name").eq("id", subjectId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (grade.error || subject.error) throw grade.error ?? subject.error;
  return { gradeLabel: grade.data?.display_name ?? null, subjectName: subject.data?.name ?? null };
}

/** The student's active section, or null for staff. */
export async function studentSection(supabase: Client, ctx: TenantContext): Promise<string | null> {
  if (!ctx.membership.studentId) return null;
  const { data, error } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", ctx.membership.studentId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.class_section_id ?? notFound();
}

async function unitSource(supabase: Client, ctx: TenantContext, unitId: string, asStudent: boolean): Promise<ResolvedSource> {
  const { data: unit, error } = await supabase
    .from("curriculum_units")
    .select("id, title, description, grade_id, subject_id")
    .eq("id", unitId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!unit) return notFound();
  if (asStudent) {
    // The unit's subject must be taught in the student's own section (same rule as practice).
    const sectionId = await studentSection(supabase, ctx);
    const { data: assigned, error: aError } = await supabase
      .from("subject_assignments")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("class_section_id", sectionId!)
      .eq("subject_id", unit.subject_id)
      .limit(1)
      .maybeSingle();
    if (aError) throw aError;
    if (!assigned) return notFound();
  }
  const n = await names(supabase, unit.grade_id, unit.subject_id);
  return {
    title: unit.title,
    sourceLabel: "a curriculum unit (title and outline)",
    lines: [`Unit: ${unit.title}`, `Outline: ${unit.description ?? "(no outline written; use the unit title)"}`],
    ...n,
    subjectId: unit.subject_id,
    unitId: unit.id,
    resourceId: null,
  };
}

async function resourceSource(supabase: Client, ctx: TenantContext, resourceId: string): Promise<ResolvedSource> {
  // RLS: students see published resources for their own sections; teachers their own or published ones.
  const { data: r, error } = await supabase
    .from("resources")
    .select("id, title, kind, description, subject_id, curriculum_unit_id, curriculum_units(title, description, grade_id)")
    .eq("id", resourceId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!r) return notFound();
  const unit = r.curriculum_units as { title: string; description: string | null; grade_id: string } | null;
  const n = await names(supabase, unit?.grade_id ?? null, r.subject_id);
  return {
    title: r.title,
    sourceLabel: "a learning resource the school shared",
    lines: [
      `Resource: ${r.title} (${r.kind})`,
      r.description ? `Text: ${r.description}` : "",
      unit ? `Curriculum unit: ${unit.title}. ${unit.description ?? ""}` : "",
    ].filter(Boolean),
    ...n,
    subjectId: r.subject_id,
    unitId: r.curriculum_unit_id,
    resourceId: r.id,
  };
}

async function lessonPlanSource(supabase: Client, ctx: TenantContext, lessonPlanId: string): Promise<ResolvedSource> {
  const { data: lp, error } = await supabase
    .from("lesson_plans")
    .select("id, title, objectives, resources, subject_id, curriculum_unit_id, class_sections(grade_id), curriculum_units(title, description)")
    .eq("id", lessonPlanId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!lp) return notFound();
  const section = lp.class_sections as { grade_id: string } | null;
  const unit = lp.curriculum_units as { title: string; description: string | null } | null;
  const n = await names(supabase, section?.grade_id ?? null, lp.subject_id);
  return {
    title: lp.title,
    sourceLabel: "a teacher's lesson plan",
    lines: [
      `Lesson: ${lp.title}`,
      `Objectives: ${lp.objectives}`,
      lp.resources ? `Resources: ${lp.resources}` : "",
      unit ? `Curriculum unit: ${unit.title}. ${unit.description ?? ""}` : "",
    ].filter(Boolean),
    ...n,
    subjectId: lp.subject_id,
    unitId: lp.curriculum_unit_id,
    resourceId: null,
  };
}

async function pasteSource(supabase: Client, ctx: TenantContext, text: string, subjectId: string | undefined): Promise<ResolvedSource> {
  let subject: { gradeLabel: string | null; subjectName: string | null } = { gradeLabel: null, subjectName: null };
  if (subjectId) {
    subject = await names(supabase, null, subjectId);
    if (!subject.subjectName) return notFound();
  }
  return {
    title: "Pasted notes",
    sourceLabel: "notes pasted by the user",
    lines: [text],
    ...subject,
    subjectId: subjectId ?? null,
    unitId: null,
    resourceId: null,
  };
}

/** 0139: the unit (same access rule as a unit source) plus its linked textbook chapter reference and any pasted chapter text. The book itself is never read. */
async function textbookSource(supabase: Client, ctx: TenantContext, unitId: string, text: string | undefined, asStudent: boolean): Promise<ResolvedSource> {
  const unit = await unitSource(supabase, ctx, unitId, asStudent);
  const { data: link, error } = await supabase
    .from("curriculum_unit_chapters")
    .select("chapter_no, subject_textbooks(custom_title, custom_publisher, chapter_titles, ncert_textbooks(title, class_level))")
    .eq("curriculum_unit_id", unitId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  const book = link?.subject_textbooks as { custom_title: string | null; custom_publisher: string | null; chapter_titles: unknown; ncert_textbooks: { title: string; class_level: number | null } | null } | null;
  if (!link || !book) throw new AppError("validation_failed", "This unit has no textbook chapter linked yet. Ask your teacher, or use the unit or pasted notes instead.");
  const bookName = book.ncert_textbooks ? `${book.ncert_textbooks.title} (NCERT${book.ncert_textbooks.class_level ? `, Class ${book.ncert_textbooks.class_level}` : ""})` : `${book.custom_title}${book.custom_publisher ? ` (${book.custom_publisher})` : ""}`;
  const chapterTitle = ((book.chapter_titles ?? {}) as Record<string, string>)[String(link.chapter_no)];
  return {
    ...unit,
    sourceLabel: "a curriculum unit and a reference to its textbook chapter (the AI has NOT read the book)",
    lines: [
      `Textbook reference: chapter ${link.chapter_no}${chapterTitle ? ` ("${chapterTitle}")` : ""} of ${bookName}.`,
      "You have not read this book or its PDF. Do not quote it or claim what it says; work only from the unit outline below and any text the student pasted.",
      ...unit.lines,
      text ? `Text pasted from the chapter: ${text}` : "",
    ].filter(Boolean),
  };
}

export async function resolveStudySource(ctx: TenantContext, source: StudySource, audience: "student" | "teacher"): Promise<ResolvedSource> {
  const supabase = await createClient();
  switch (source.kind) {
    case "unit":
      return unitSource(supabase, ctx, source.unitId, audience === "student");
    case "resource":
      return resourceSource(supabase, ctx, source.resourceId);
    case "lesson_plan":
      return lessonPlanSource(supabase, ctx, source.lessonPlanId);
    case "paste":
      return pasteSource(supabase, ctx, source.text, source.subjectId);
    case "textbook":
      return textbookSource(supabase, ctx, source.unitId, source.text, audience === "student");
    case "file":
      return fileSource(supabase, ctx, source.materialId, audience);
    case "weak_units":
      if (audience !== "student") throw new AppError("forbidden", "A revision pack is made from your own practice.");
      return weakUnitsSource(supabase, ctx);
    case "class_weak_units":
      if (audience !== "teacher") throw new AppError("forbidden", "Only a teacher makes a class revision pack.");
      return classWeakUnitsSource(supabase, ctx, source.sectionId);
    case "scope":
      if (audience !== "student") throw new AppError("forbidden", "Study scopes belong to students.");
      return scopeSource(ctx, source.itemId);
    case "units":
      if (audience !== "teacher") throw new AppError("forbidden", "Pick a scope on the Study with AI page.");
      return teacherUnitsSource(supabase, ctx, source.unitIds);
  }
}
