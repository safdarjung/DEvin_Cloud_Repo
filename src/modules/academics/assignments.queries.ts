import "server-only";
// T-022 — assignments module reads (06 §W6). Always the signed-in user's
// RLS client (CLAUDE.md: "reads for pages go through the user's RLS client,
// never the service role"); explicit institution_id / status filters below
// are defense in depth on top of RLS (0005 assignments_select etc.), not a
// replacement for it.
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import {
  AnswerKeyContentSchema,
  QuizStoredContentSchema,
  mergeQuizContent,
  type AnswerKeyContent,
  type QuizContent,
  type QuizStoredContent,
} from "./assignments.schemas";
import { managesWholeSection, taughtSectionIds } from "./teacher-scope";

export interface AssignmentSummary {
  id: string;
  title: string;
  status: "draft" | "published" | "closed";
  classSectionId: string;
  subjectId: string;
  dueAt: string | null;
  aiGenerated: boolean;
  createdAt: string;
}

export interface AssignmentDetail extends AssignmentSummary {
  instructions: string | null;
  curriculumUnitId: string | null;
  content: QuizContent | null;
  createdBy: string;
  /** 0140: linked study-studio material (students of the section can open it). */
  studyMaterialId: string | null;
}

interface AssignmentSummaryRow {
  id: string;
  title: string;
  status: string;
  class_section_id: string;
  subject_id: string;
  due_at: string | null;
  ai_generated: boolean;
  created_at: string;
}

function toSummary(row: AssignmentSummaryRow): AssignmentSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as AssignmentSummary["status"],
    classSectionId: row.class_section_id,
    subjectId: row.subject_id,
    dueAt: row.due_at,
    aiGenerated: row.ai_generated,
    createdAt: row.created_at,
  };
}

// Unvalidated `content` jsonb never reaches a client as-is; only a value
// that still matches QuizStoredContentSchema is returned, since it may
// predate a schema tightening (DBT-21: `content` holds stems/options only
// now — answers live in `assignment_answer_keys`, see getAssignment below).
function parseStoredContent(content: unknown): QuizStoredContent | null {
  if (content == null) return null;
  const parsed = QuizStoredContentSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

function parseAnswerKey(answers: unknown): AnswerKeyContent | null {
  if (answers == null) return null;
  const parsed = AnswerKeyContentSchema.safeParse(answers);
  return parsed.success ? parsed.data : null;
}

/**
 * The staff list page (06 §W6). RLS lets any staff role read every
 * assignment in the institution (0005 `assignments_select`); teachers get an
 * additional "my assignments" business filter here so the list is useful,
 * not a security boundary — owner/principal/admin see everything.
 */
export async function listTeacherAssignments(ctx: TenantContext): Promise<AssignmentSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("assignments")
    .select("id, title, status, class_section_id, subject_id, due_at, ai_generated, created_at")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });

  if (ctx.membership.role === "teacher" && ctx.membership.staffId) {
    query = query.eq("created_by", ctx.membership.staffId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toSummary);
}

export async function getAssignment(ctx: TenantContext, assignmentId: string): Promise<AssignmentDetail | null> {
  const supabase = await createClient();
  let query = supabase
    .from("assignments")
    .select(
      "id, title, status, class_section_id, subject_id, due_at, ai_generated, created_at, created_by, instructions, curriculum_unit_id, content, study_material_id",
    )
    .eq("id", assignmentId)
    .eq("institution_id", ctx.institution.id);

  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") {
    query = query.eq("status", "published");
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const canManage = hasPermission(ctx, "assignment.manage");
  const stored = parseStoredContent(data.content);

  // DBT-21: the answer key lives in a separate, staff-only-RLS table — only
  // fetched for a caller who holds assignment.manage, so a guardian/student
  // never even issues the query that could return answers (defense in
  // depth alongside that table's own RLS, not a replacement for it).
  let answers: AnswerKeyContent | null = null;
  if (stored && canManage) {
    const { data: keyRow, error: keyError } = await supabase
      .from("assignment_answer_keys")
      .select("answers")
      .eq("assignment_id", assignmentId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (keyError) throw keyError;
    answers = keyRow ? parseAnswerKey(keyRow.answers) : null;
  }

  return {
    ...toSummary(data),
    instructions: data.instructions,
    curriculumUnitId: data.curriculum_unit_id,
    // `answers === null` (no assignment.manage, or no key row) yields the
    // same "" / undefined shape redactQuizAnswers used to produce — rule 3,
    // never left to the UI to hide.
    content: stored ? mergeQuizContent(stored, answers) : null,
    createdBy: data.created_by,
    studyMaterialId: data.study_material_id,
  };
}

/** Published assignments for one student's active section(s) — guardian/student portal use (T-034). */
export async function listStudentAssignments(ctx: TenantContext, studentId: string): Promise<AssignmentSummary[]> {
  const supabase = await createClient();
  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("class_section_id")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .eq("status", "active");
  if (enrolError) throw enrolError;

  const sectionIds = [...new Set((enrolments ?? []).map((row) => row.class_section_id))];
  if (sectionIds.length === 0) return [];

  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, status, class_section_id, subject_id, due_at, ai_generated, created_at")
    .eq("institution_id", ctx.institution.id)
    .in("class_section_id", sectionIds)
    .eq("status", "published")
    .order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map(toSummary);
}

/** A guardian's own children's ids (for the /assignments page — T-034 owns the full portal). */
export async function listGuardianChildren(ctx: TenantContext): Promise<string[]> {
  if (!ctx.membership.guardianId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("guardian_students")
    .select("student_id")
    .eq("institution_id", ctx.institution.id)
    .eq("guardian_id", ctx.membership.guardianId);
  if (error) throw error;
  return (data ?? []).map((row) => row.student_id);
}

export interface CurriculumUnitOption {
  id: string;
  title: string;
  sequence: number;
}

export async function listCurriculumUnits(
  ctx: TenantContext,
  filter: { gradeId: string; subjectId: string },
): Promise<CurriculumUnitOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("id, title, sequence")
    .eq("institution_id", ctx.institution.id)
    .eq("grade_id", filter.gradeId)
    .eq("subject_id", filter.subjectId)
    .order("sequence", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface SectionOption {
  id: string;
  label: string;
  gradeId: string;
}

/** Sections to offer in the "new assignment" form: owner/principal see all, a teacher sees only sections they teach. */
export async function listTeachableSections(ctx: TenantContext): Promise<SectionOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, name, grade_id, class_teacher_id, grades(code)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  let rows = data ?? [];

  if (ctx.membership.role === "teacher" && ctx.membership.staffId) {
    const taughtIds = await taughtSectionIds(supabase, ctx.institution.id, ctx.membership.staffId);
    rows = rows.filter((row) => managesWholeSection(ctx, row.class_teacher_id) || taughtIds.has(row.id));
  }

  // Grade code first ("VIII-B"), as the exams module labels sections: a bare "B" is ambiguous across grades.
  return rows.map((row) => {
    const grade = (row.grades as { code: string } | null)?.code;
    return { id: row.id, label: grade ? `${grade}-${row.name}` : row.name, gradeId: row.grade_id };
  });
}

export interface SubjectOption {
  id: string;
  name: string;
}

/** Subjects selectable for a given section: all institution subjects for owner/principal/the section's class teacher, else only subjects assigned to this teacher for this section. */
export async function listSectionSubjects(ctx: TenantContext, classSectionId: string): Promise<SubjectOption[]> {
  const supabase = await createClient();

  async function allSubjects(): Promise<SubjectOption[]> {
    const { data, error } = await supabase
      .from("subjects")
      .select("id, name")
      .eq("institution_id", ctx.institution.id)
      .order("name");
    if (error) throw error;
    return data ?? [];
  }

  const { data: section, error: sectionError } = await supabase
    .from("class_sections")
    .select("class_teacher_id")
    .eq("id", classSectionId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (sectionError) throw sectionError;
  if (managesWholeSection(ctx, section?.class_teacher_id ?? null)) {
    return allSubjects();
  }
  if (!ctx.membership.staffId) return [];

  const { data: assigned, error: assignedError } = await supabase
    .from("subject_assignments")
    .select("subject_id")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", classSectionId)
    .eq("teacher_id", ctx.membership.staffId);
  if (assignedError) throw assignedError;

  const subjectIds = (assigned ?? []).map((row) => row.subject_id);
  if (subjectIds.length === 0) return [];

  const { data, error } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("institution_id", ctx.institution.id)
    .in("id", subjectIds);
  if (error) throw error;
  return data ?? [];
}

/** listTeachableSections with grade-qualified labels ("VI-A"), same convention as the register and coverage views. */
export async function listLabelledTeachableSections(ctx: TenantContext): Promise<SectionOption[]> {
  const sections = await listTeachableSections(ctx);
  if (sections.length === 0) return sections;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grades")
    .select("id, code, sort_key")
    .eq("institution_id", ctx.institution.id)
    .in("id", [...new Set(sections.map((s) => s.gradeId))]);
  if (error) throw error;
  const grade = new Map((data ?? []).map((g) => [g.id, g]));
  return sections
    .map((s) => ({ ...s, label: `${grade.get(s.gradeId)?.code ?? "?"}-${s.label}`, sort: grade.get(s.gradeId)?.sort_key ?? 0 }))
    .sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label))
    .map(({ id, label, gradeId }) => ({ id, label, gradeId }));
}
