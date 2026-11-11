import "server-only";
// Study help reads (0140). Session client only: RLS decides every row. A
// student sees their own files, questions and packs; a linked guardian their
// child's questions (never materials); a teacher the questions of the
// (section, subject) pairs they teach and the files of subjects they teach.
import type { TenantContext } from "@/lib/auth/types";
import { FILE_READ_MAX_BYTES } from "@/lib/ai/file-input";
import { createClient } from "@/lib/supabase/server";
import { taughtGradeSubjects } from "@/modules/study/help-sources";

export interface StudyFileOption {
  id: string;
  title: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  subjectId: string | null;
  /** "mine" = the caller's own upload; "class" = a class file. */
  kind: "mine" | "class";
  /** Over the file-reading byte cap: listed, but cannot be read. */
  tooBig: boolean;
}

/** Files the caller may turn into study material: a student's own shelf + class files; a teacher's own uploads + class files of subjects they teach. */
export async function studyFileOptions(ctx: TenantContext): Promise<StudyFileOption[]> {
  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("curriculum_materials")
    .select("id, title, grade_id, subject_id, owner_kind, student_id, visibility, created_by")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const taught = ctx.membership.role === "teacher" ? await taughtGradeSubjects(supabase, ctx) : [];
  const allowed = (rows ?? []).filter((m) => {
    if (m.created_by === ctx.user.id) return ctx.membership.role !== "student" || (m.owner_kind === "student" && m.student_id === ctx.membership.studentId);
    if (m.visibility !== "class") return false;
    if (ctx.membership.role === "student") return true; // RLS: class files of the student's own (grade, subject) pairs
    return taught.some((p) => p.gradeId === m.grade_id && p.subjectId === m.subject_id);
  });
  if (allowed.length === 0) return [];
  const { data: docs, error: dError } = await supabase
    .from("documents")
    .select("entity_id, file_name, mime, size_bytes")
    .eq("institution_id", ctx.institution.id)
    .eq("entity_type", "curriculum_material")
    .eq("status", "active")
    .in(
      "entity_id",
      allowed.map((m) => m.id),
    );
  if (dError) throw dError;
  const byId = new Map((docs ?? []).map((d) => [d.entity_id, d]));
  return allowed.flatMap((m) => {
    const d = byId.get(m.id);
    if (!d) return [];
    return [{ id: m.id, title: m.title, fileName: d.file_name, mime: d.mime, sizeBytes: d.size_bytes, subjectId: m.subject_id, kind: m.created_by === ctx.user.id ? "mine" : "class", tooBig: d.size_bytes > FILE_READ_MAX_BYTES }];
  });
}

export async function hasFileConsent(ctx: TenantContext): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("study_ai_consents").select("kind").eq("institution_id", ctx.institution.id).eq("user_id", ctx.user.id).eq("kind", "file_reading").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** Units of the student's newest revision pack (feeds the planner as weak topics). */
export async function latestPackUnitIds(ctx: TenantContext): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_materials")
    .select("focus_unit_ids")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .eq("source_kind", "revision_pack")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.focus_unit_ids ?? [];
}

/** The original and its language versions the caller can read. */
export async function materialVariants(ctx: TenantContext, baseId: string): Promise<{ id: string; language: "en" | "hi" }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_materials")
    .select("id, language, variant_of, created_at")
    .eq("institution_id", ctx.institution.id)
    .or(`id.eq.${baseId},variant_of.eq.${baseId}`)
    .order("created_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  // One per language: the original first, then the newest translation.
  const out = new Map<string, { id: string; language: "en" | "hi" }>();
  for (const r of data ?? []) if (!out.has(r.language) || r.variant_of) out.set(r.language, { id: r.id, language: r.language as "en" | "hi" });
  return [...out.values()];
}

export interface StudyQuestionRow {
  id: string;
  subjectName: string | null;
  contextKind: string;
  contextExcerpt: string | null;
  materialId: string | null;
  question: string;
  answer: string | null;
  answeredAt: string | null;
  createdAt: string;
  /** Teacher inbox only. */
  studentName?: string;
  sectionLabel?: string;
}

const QUESTION_COLUMNS = "id, context_kind, context_excerpt, material_id, question, answer, answered_at, created_at, subjects(name)";

function toRow(r: Record<string, unknown>): StudyQuestionRow {
  return {
    id: r.id as string,
    subjectName: (r.subjects as { name: string } | null)?.name ?? null,
    contextKind: r.context_kind as string,
    contextExcerpt: r.context_excerpt as string | null,
    materialId: r.material_id as string | null,
    question: r.question as string,
    answer: r.answer as string | null,
    answeredAt: r.answered_at as string | null,
    createdAt: r.created_at as string,
  };
}

/** A student's questions (own, or a linked guardian's child's). */
export async function studentQuestions(ctx: TenantContext, studentId: string, limit = 30): Promise<StudyQuestionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_questions")
    .select(QUESTION_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

/** Questions from students the teacher teaches in that subject (RLS), unanswered first. */
export async function teacherQuestionInbox(ctx: TenantContext, limit = 50): Promise<StudyQuestionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_questions")
    .select(`${QUESTION_COLUMNS}, students(first_name, last_name), class_sections(name, grades(code))`)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? [])
    .map((r) => {
      const s = r.students as { first_name: string; last_name: string | null } | null;
      const sec = r.class_sections as { name: string; grades: { code: string } | null } | null;
      return { ...toRow(r as Record<string, unknown>), studentName: [s?.first_name, s?.last_name].filter(Boolean).join(" "), sectionLabel: `${sec?.grades?.code ?? ""}-${sec?.name ?? ""}` };
    })
    .sort((a, b) => Number(a.answer !== null) - Number(b.answer !== null));
}

/** Recent mock exam attempts (student or linked guardian: study_quiz_attempts RLS). Practice only. */
export async function mockAttempts(ctx: TenantContext, studentId: string): Promise<{ id: string; title: string; score: number; max: number; createdAt: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_quiz_attempts")
    .select("id, title, auto_score, auto_max, ai_points, ai_max, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .like("title", "Mock exam:%")
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  return (data ?? []).map((a) => ({ id: a.id, title: a.title, score: a.auto_score + a.ai_points / 2, max: a.auto_max + a.ai_max / 2, createdAt: a.created_at }));
}

/** (section, subject) pairs the teacher teaches, labelled, for assigning homework. */
export async function taughtPairs(ctx: TenantContext): Promise<{ sectionId: string; sectionLabel: string; subjectId: string; subjectName: string }[]> {
  if (!ctx.membership.staffId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subject_assignments")
    .select("class_section_id, subject_id, subjects(name), class_sections(name, grades(code))")
    .eq("institution_id", ctx.institution.id)
    .eq("teacher_id", ctx.membership.staffId);
  if (error) throw error;
  return (data ?? [])
    .map((r) => {
      const sec = r.class_sections as { name: string; grades: { code: string } | null } | null;
      return { sectionId: r.class_section_id, sectionLabel: `${sec?.grades?.code ?? ""}-${sec?.name ?? ""}`, subjectId: r.subject_id, subjectName: (r.subjects as { name: string } | null)?.name ?? "" };
    })
    .sort((a, b) => a.sectionLabel.localeCompare(b.sectionLabel) || a.subjectName.localeCompare(b.subjectName));
}
