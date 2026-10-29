import "server-only";
// T-018 — exams module reads (06 §W7). Always the signed-in user's RLS
// client (CLAUDE.md); explicit institution_id filters below are defense in
// depth on top of RLS (0009 exams_select/exam_papers_select/marks_select),
// not a replacement for it.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";

export interface TermOption {
  id: string;
  label: string;
}

/** Terms for the current academic year — the `createExam` form's term picker. */
export async function listTermOptions(ctx: TenantContext): Promise<TermOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("terms")
    .select("id, name, sequence, academic_years!inner(is_current)")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_years.is_current", true)
    .order("sequence");
  if (error) throw error;
  return (data ?? []).map((t) => ({ id: t.id, label: t.name }));
}

export interface SectionOption {
  id: string;
  label: string;
}

/** Every class section — the `createExamPapers` picker is controller-only (exam.manage), so no teacher narrowing. */
export async function listSectionOptions(ctx: TenantContext): Promise<SectionOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("class_sections")
    .select("id, name, grades(code)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    label: `${(row.grades as { code: string } | null)?.code ?? "?"}-${row.name}`,
  }));
}

export interface SubjectOption {
  id: string;
  name: string;
}

export async function listSubjectOptions(ctx: TenantContext): Promise<SubjectOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

export interface ExamSummary {
  id: string;
  name: string;
  type: string;
  status: string;
  termId: string;
  termName: string;
}

export async function listExams(ctx: TenantContext): Promise<ExamSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("exams")
    .select("id, name, type, status, term_id, terms(name)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    termId: row.term_id,
    termName: (row.terms as { name: string } | null)?.name ?? "",
  }));
}

export interface ExamPaperSummary {
  id: string;
  classSectionId: string;
  sectionLabel: string;
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  passMarks: number;
  heldOn: string | null;
}

export interface ExamDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  termId: string;
  gradingScaleKey: string;
  papers: ExamPaperSummary[];
}

export async function getExamWithPapers(ctx: TenantContext, examId: string): Promise<ExamDetail | null> {
  const supabase = await createClient();
  const { data: exam, error: examError } = await supabase
    .from("exams")
    .select("id, name, type, status, term_id, grading_scale_key")
    .eq("id", examId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (examError) throw examError;
  if (!exam) return null;

  const { data: papers, error: papersError } = await supabase
    .from("exam_papers")
    .select("id, class_section_id, subject_id, max_marks, pass_marks, held_on, class_sections(name, grades(code)), subjects(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("exam_id", examId)
    .order("held_on", { ascending: true, nullsFirst: true });
  if (papersError) throw papersError;

  return {
    id: exam.id,
    name: exam.name,
    type: exam.type,
    status: exam.status,
    termId: exam.term_id,
    gradingScaleKey: exam.grading_scale_key,
    papers: (papers ?? []).map((row) => {
      const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
      const subject = row.subjects as { name: string } | null;
      return {
        id: row.id,
        classSectionId: row.class_section_id,
        sectionLabel: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`,
        subjectId: row.subject_id,
        subjectName: subject?.name ?? "",
        maxMarks: row.max_marks,
        passMarks: row.pass_marks,
        heldOn: row.held_on,
      };
    }),
  };
}

export interface PaperMarksRow {
  studentId: string;
  name: string;
  rollNo: number | null;
  marksObtained: number | null;
  isAbsent: boolean;
  versionNo: number | null;
}

export interface PaperMarks {
  paperId: string;
  examId: string;
  examStatus: string;
  classSectionId: string;
  subjectId: string;
  subjectName: string;
  sectionLabel: string;
  maxMarks: number;
  passMarks: number;
  students: PaperMarksRow[];
}

/** The marks-entry grid for one paper: every actively enrolled student in the paper's section, with their current marks version if any. */
export async function getPaperMarks(ctx: TenantContext, paperId: string): Promise<PaperMarks | null> {
  const supabase = await createClient();
  const { data: paper, error: paperError } = await supabase
    .from("exam_papers")
    .select(
      "id, exam_id, class_section_id, subject_id, max_marks, pass_marks, exams(status), subjects(name), class_sections(name, grades(code))",
    )
    .eq("id", paperId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (paperError) throw paperError;
  if (!paper) return null;

  // Fix round 1 (LOW, security review): RLS lets any exam.marks.enter-holding
  // teacher SELECT any paper in the institution (0009's broad staff-wide
  // marks_select OR clause scopes INSERT/UPDATE, not SELECT narrowly enough
  // here) — a teacher could otherwise open another paper's roster by guessing
  // its UUID. Same scope rule as getMyPapers: manager roles see every paper,
  // a teacher only one they hold a subject_assignments row for.
  const isManager = ctx.membership.role === "owner" || ctx.membership.role === "principal" || ctx.membership.role === "exam_controller";
  if (!isManager) {
    if (!ctx.membership.staffId) return null;
    const { data: assignment, error: assignmentError } = await supabase
      .from("subject_assignments")
      .select("id")
      .eq("institution_id", ctx.institution.id)
      .eq("class_section_id", paper.class_section_id)
      .eq("subject_id", paper.subject_id)
      .eq("teacher_id", ctx.membership.staffId)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    if (!assignment) return null;
  }

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, roll_no, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", paper.class_section_id)
    .eq("status", "active")
    .order("roll_no", { ascending: true, nullsFirst: false });
  if (enrolError) throw enrolError;

  const { data: marks, error: marksError } = await supabase
    .from("marks")
    .select("student_id, marks_obtained, is_absent, version_no")
    .eq("institution_id", ctx.institution.id)
    .eq("exam_paper_id", paperId)
    .is("superseded_by", null);
  if (marksError) throw marksError;

  const marksByStudent = new Map(marks?.map((m) => [m.student_id, m]));
  const exam = paper.exams as { status: string } | null;
  const subject = paper.subjects as { name: string } | null;
  const section = paper.class_sections as { name: string; grades: { code: string } | null } | null;

  return {
    paperId: paper.id,
    examId: paper.exam_id,
    examStatus: exam?.status ?? "draft",
    classSectionId: paper.class_section_id,
    subjectId: paper.subject_id,
    subjectName: subject?.name ?? "",
    sectionLabel: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`,
    maxMarks: paper.max_marks,
    passMarks: paper.pass_marks,
    students: (enrolments ?? []).map((row) => {
      const student = row.students as { first_name: string; last_name: string | null } | null;
      const mark = marksByStudent.get(row.student_id);
      return {
        studentId: row.student_id,
        name: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
        rollNo: row.roll_no,
        marksObtained: mark?.marks_obtained ?? null,
        isAbsent: mark?.is_absent ?? false,
        versionNo: mark?.version_no ?? null,
      };
    }),
  };
}

export interface MyPaperSummary {
  id: string;
  examId: string;
  examName: string;
  examStatus: string;
  sectionLabel: string;
  subjectName: string;
}

/** Papers the signed-in member may enter marks for: owner/principal/exam_controller see every open paper; a teacher sees only papers for sections+subjects they're assigned (exam.marks.enter's matrix row, subject-level). */
export async function getMyPapers(ctx: TenantContext): Promise<MyPaperSummary[]> {
  const supabase = await createClient();
  const isManager = ctx.membership.role === "owner" || ctx.membership.role === "principal" || ctx.membership.role === "exam_controller";

  let paperIds: Set<string> | null = null;
  if (!isManager) {
    if (!ctx.membership.staffId) return [];
    const { data: assignments, error: assignmentsError } = await supabase
      .from("subject_assignments")
      .select("class_section_id, subject_id")
      .eq("institution_id", ctx.institution.id)
      .eq("teacher_id", ctx.membership.staffId);
    if (assignmentsError) throw assignmentsError;
    if (!assignments || assignments.length === 0) return [];

    const { data: papers, error: papersError } = await supabase
      .from("exam_papers")
      .select("id, class_section_id, subject_id")
      .eq("institution_id", ctx.institution.id);
    if (papersError) throw papersError;

    const assigned = new Set(assignments.map((a) => `${a.class_section_id}:${a.subject_id}`));
    paperIds = new Set(
      (papers ?? []).filter((p) => assigned.has(`${p.class_section_id}:${p.subject_id}`)).map((p) => p.id),
    );
    if (paperIds.size === 0) return [];
  }

  let query = supabase
    .from("exam_papers")
    .select(
      "id, exam_id, exams!inner(name, status, institution_id), subjects(name), class_sections(name, grades(code))",
    )
    .eq("institution_id", ctx.institution.id)
    .in("exams.status", ["marks_entry", "verification"]);
  if (paperIds) query = query.in("id", [...paperIds]);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => {
    const exam = row.exams as { name: string; status: string } | null;
    const subject = row.subjects as { name: string } | null;
    const section = row.class_sections as { name: string; grades: { code: string } | null } | null;
    return {
      id: row.id,
      examId: row.exam_id,
      examName: exam?.name ?? "",
      examStatus: exam?.status ?? "",
      sectionLabel: `${section?.grades?.code ?? "?"}-${section?.name ?? "?"}`,
      subjectName: subject?.name ?? "",
    };
  });
}
