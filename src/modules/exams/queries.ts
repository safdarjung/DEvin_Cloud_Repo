import "server-only";
// T-018 — exams module reads (06 §W7). Always the signed-in user's RLS
// client (CLAUDE.md); explicit institution_id filters below are defense in
// depth on top of RLS (0009 exams_select/exam_papers_select/marks_select),
// not a replacement for it.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { marksProgress, type PaperProgress, type PaperTeacher } from "./marks-progress";

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
    .select("id, name, grades(code, sort_key)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  // Grade order (sort_key), then section name — not alphabetical on the label.
  const sortKey = (row: (typeof rows)[number]) => (row.grades as { sort_key: number } | null)?.sort_key ?? Number.MAX_SAFE_INTEGER;
  const rows = data ?? [];
  return [...rows]
    .sort((a, b) => sortKey(a) - sortKey(b) || a.name.localeCompare(b.name))
    .map((row) => ({
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
  scheduledAt: string | null;
  durationMinutes: number | null;
  roomId: string | null;
}

export interface ExamDetail {
  id: string;
  name: string;
  type: string;
  status: string;
  termId: string;
  gradingScaleKey: string;
  /** 0154: date every paper's marks are due, or null. */
  marksDueOn: string | null;
  papers: ExamPaperSummary[];
}

export async function getExamWithPapers(ctx: TenantContext, examId: string): Promise<ExamDetail | null> {
  const supabase = await createClient();
  const { data: exam, error: examError } = await supabase
    .from("exams")
    .select("id, name, type, status, term_id, grading_scale_key, marks_due_on")
    .eq("id", examId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (examError) throw examError;
  if (!exam) return null;

  const { data: papers, error: papersError } = await supabase
    .from("exam_papers")
    .select("id, class_section_id, subject_id, max_marks, pass_marks, held_on, scheduled_at, duration_minutes, room_id, class_sections(name, grades(code)), subjects(name)")
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
    marksDueOn: exam.marks_due_on,
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
        scheduledAt: row.scheduled_at,
        durationMinutes: row.duration_minutes,
        roomId: row.room_id,
      };
    }),
  };
}

/** 0154: who has entered marks for each paper of an exam (the exam office's "not submitted" list). */
export async function getMarksProgress(ctx: TenantContext, exam: Pick<ExamDetail, "id" | "papers">): Promise<PaperProgress[]> {
  if (exam.papers.length === 0) return [];
  const supabase = await createClient();
  const sectionIds = [...new Set(exam.papers.map((p) => p.classSectionId))];
  const [counts, assignments, sections] = await Promise.all([
    supabase.rpc("exam_marks_progress", { p_institution_id: ctx.institution.id, p_exam_id: exam.id }),
    supabase
      .from("subject_assignments")
      .select("class_section_id, subject_id, staff(id, user_id, full_name)")
      .eq("institution_id", ctx.institution.id)
      .in("class_section_id", sectionIds),
    supabase.from("class_sections").select("id, staff(id, user_id, full_name)").eq("institution_id", ctx.institution.id).in("id", sectionIds),
  ]);
  for (const r of [counts, assignments, sections]) if (r.error) throw r.error;

  type StaffRow = { id: string; user_id: string | null; full_name: string } | null;
  const asTeacher = (s: StaffRow): PaperTeacher | null => (s ? { staffId: s.id, userId: s.user_id, name: s.full_name } : null);
  const subjectTeachers = new Map<string, PaperTeacher>();
  for (const a of assignments.data ?? []) {
    const t = asTeacher(a.staff as StaffRow);
    if (t) subjectTeachers.set(`${a.class_section_id}:${a.subject_id}`, t);
  }
  const classTeachers = new Map<string, PaperTeacher>();
  for (const s of sections.data ?? []) {
    const t = asTeacher(s.staff as StaffRow);
    if (t) classTeachers.set(s.id, t);
  }
  return marksProgress(
    exam.papers.map((p) => ({ id: p.id, sectionId: p.classSectionId, subjectId: p.subjectId, label: `${p.sectionLabel} ${p.subjectName}` })),
    new Map((counts.data ?? []).map((c) => [c.paper_id, { entered: c.entered, total: c.total }])),
    subjectTeachers,
    classTeachers,
  );
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

// ---------------------------------------------------------------------------
// T-019 — results reads (06 §W7). `results` carries no subject names in its
// snapshot (only `subject_id`, 0009's snapshot shape) — resolved here via a
// second query, same shape as getExamWithPapers resolving section/subject
// names for exam_papers. Guardian/student scope is pure RLS (0009
// results_select): a studentId they can't see simply yields no row, so
// getCurrentResult returns null and the page calls notFound() — rule 3.
// ---------------------------------------------------------------------------

/** Roles the matrix (07 §2.2) gives result-version history to — narrower than exam.result.read, which guardians/students/teachers also hold. */
const EXAM_HISTORY_ROLES = new Set(["owner", "principal", "admin", "exam_controller"]);

interface ResultSnapshotSubject {
  exam_paper_id: string;
  subject_id: string;
  marks_obtained: number | null;
  max_marks: number;
  is_absent: boolean;
  passed: boolean;
  grade: string | null;
}

interface ResultSnapshot {
  subjects: ResultSnapshotSubject[];
  attendancePercentage: number;
}

export interface ResultSubjectRow {
  examPaperId: string;
  subjectId: string;
  subjectName: string;
  marksObtained: number | null;
  maxMarks: number;
  isAbsent: boolean;
  passed: boolean;
  grade: string | null;
}

export interface ResultDetail {
  id: string;
  examId: string;
  examName: string;
  examType: string;
  studentId: string;
  studentName: string;
  admissionNo: string;
  versionNo: number;
  total: number;
  maxTotal: number;
  percentage: number;
  grade: string;
  attendancePercentage: number;
  publishedAt: string;
  /** version_no > 1 — ReportCard's "Corrected on <date>" note. */
  isCorrected: boolean;
  subjects: ResultSubjectRow[];
}

type ResultRow = {
  id: string;
  exam_id: string;
  student_id: string;
  snapshot: unknown;
  total: number;
  max_total: number;
  percentage: number;
  grade: string;
  version_no: number;
  published_at: string;
  exams: { name: string; type: string } | null;
  students: { first_name: string; last_name: string | null; admission_no: string } | null;
};

async function hydrateResultRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  institutionId: string,
  row: ResultRow,
): Promise<ResultDetail> {
  const snapshot = row.snapshot as ResultSnapshot;
  const subjectIds = [...new Set(snapshot.subjects.map((s) => s.subject_id))];

  const { data: subjects, error: subjectsError } =
    subjectIds.length > 0
      ? await supabase.from("subjects").select("id, name").eq("institution_id", institutionId).in("id", subjectIds)
      : { data: [], error: null };
  if (subjectsError) throw subjectsError;
  const subjectNameById = new Map((subjects ?? []).map((s) => [s.id, s.name]));

  return {
    id: row.id,
    examId: row.exam_id,
    examName: row.exams?.name ?? "",
    examType: row.exams?.type ?? "",
    studentId: row.student_id,
    studentName: [row.students?.first_name, row.students?.last_name].filter(Boolean).join(" "),
    admissionNo: row.students?.admission_no ?? "",
    versionNo: row.version_no,
    total: row.total,
    maxTotal: row.max_total,
    percentage: row.percentage,
    grade: row.grade,
    attendancePercentage: snapshot.attendancePercentage,
    publishedAt: row.published_at,
    isCorrected: row.version_no > 1,
    subjects: snapshot.subjects.map((s) => ({
      examPaperId: s.exam_paper_id,
      subjectId: s.subject_id,
      subjectName: subjectNameById.get(s.subject_id) ?? "",
      marksObtained: s.marks_obtained,
      maxMarks: s.max_marks,
      isAbsent: s.is_absent,
      passed: s.passed,
      grade: s.grade,
    })),
  };
}

const RESULT_SELECT =
  "id, exam_id, student_id, snapshot, total, max_total, percentage, grade, version_no, published_at, exams(name, type), students(first_name, last_name, admission_no)";

/** The current (never superseded) result snapshot. Rule 3: guardians/students get only this — never getResultHistory. */
export async function getCurrentResult(ctx: TenantContext, examId: string, studentId: string): Promise<ResultDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("results")
    .select(RESULT_SELECT)
    .eq("institution_id", ctx.institution.id)
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .is("superseded_by", null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return hydrateResultRow(supabase, ctx.institution.id, data as unknown as ResultRow);
}

export interface ResultListRow {
  studentId: string;
  studentName: string;
  admissionNo: string;
  total: number;
  maxTotal: number;
  percentage: number;
  grade: string;
  isCorrected: boolean;
}

export interface ExamResultsSummary {
  examId: string;
  examName: string;
  examStatus: string;
  results: ResultListRow[];
  /** grade -> count, over the rows RLS actually returned (never a bare teacher's whole class if RLS narrows it). */
  gradeDistribution: Record<string, number>;
}

/** Current-version results for every student of an exam, plus a grade distribution — the controller/teacher list (also used by T-039). RLS (0009 results_select) narrows this to the caller's own scope (teacher: sections they teach; exam roles: everyone). */
export async function listResultsForExam(ctx: TenantContext, examId: string): Promise<ExamResultsSummary | null> {
  const supabase = await createClient();
  const { data: exam, error: examError } = await supabase
    .from("exams")
    .select("id, name, status")
    .eq("id", examId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (examError) throw examError;
  if (!exam) return null;

  const { data, error } = await supabase
    .from("results")
    .select("student_id, total, max_total, percentage, grade, version_no, students(first_name, last_name, admission_no)")
    .eq("institution_id", ctx.institution.id)
    .eq("exam_id", examId)
    .is("superseded_by", null);
  if (error) throw error;

  const gradeDistribution: Record<string, number> = {};
  const results = (data ?? []).map((row) => {
    gradeDistribution[row.grade] = (gradeDistribution[row.grade] ?? 0) + 1;
    const student = row.students as { first_name: string; last_name: string | null; admission_no: string } | null;
    return {
      studentId: row.student_id,
      studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      admissionNo: student?.admission_no ?? "",
      total: row.total,
      maxTotal: row.max_total,
      percentage: row.percentage,
      grade: row.grade,
      isCorrected: row.version_no > 1,
    };
  });

  return { examId: exam.id, examName: exam.name, examStatus: exam.status, results, gradeDistribution };
}

export interface StudentResultRow {
  examId: string;
  examName: string;
  examType: string;
  total: number;
  maxTotal: number;
  percentage: number;
  grade: string;
  publishedAt: string;
}

/** Every current-version result for one student across exams — the portal's "my report cards" list (T-034). Pure RLS scope, same as getCurrentResult. */
export async function listResultsForStudent(ctx: TenantContext, studentId: string): Promise<StudentResultRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("results")
    .select("exam_id, total, max_total, percentage, grade, published_at, exams(name, type)")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .is("superseded_by", null)
    .order("published_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const exam = row.exams as { name: string; type: string } | null;
    return {
      examId: row.exam_id,
      examName: exam?.name ?? "",
      examType: exam?.type ?? "",
      total: row.total,
      maxTotal: row.max_total,
      percentage: row.percentage,
      grade: row.grade,
      publishedAt: row.published_at,
    };
  });
}

/**
 * Every version of a result, newest first — exam roles only (07 §2.2),
 * checked here (not just hidden in the UI, rule 3) so a guardian/student/
 * teacher who has `exam.result.read` can never fetch another version
 * through this function even if a page mistakenly called it.
 */
export async function getResultHistory(ctx: TenantContext, examId: string, studentId: string): Promise<ResultDetail[] | null> {
  if (!EXAM_HISTORY_ROLES.has(ctx.membership.role)) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("results")
    .select(RESULT_SELECT)
    .eq("institution_id", ctx.institution.id)
    .eq("exam_id", examId)
    .eq("student_id", studentId)
    .order("version_no", { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return null;

  return Promise.all(data.map((row) => hydrateResultRow(supabase, ctx.institution.id, row as unknown as ResultRow)));
}

// ---------------------------------------------------------------------------
// T-020 — recheck workflow reads (06 §W8). RLS (0009 recheck_requests_select,
// unchanged by 0022) already scopes every one of these to the caller: a
// guardian/student sees only their own result's requests, exam_write_roles
// sees every request in the institution — the explicit institution_id/
// result_id filters below are defense in depth on top of that, not a
// replacement for it.
// ---------------------------------------------------------------------------

export interface RecheckStatusRow {
  requestId: string;
  examPaperId: string;
  status: string;
}

/** Every recheck request (any status) against one result — ReportCard uses this to show "Request recheck" vs. the open request's status per paper. */
export async function listRechecksForResult(ctx: TenantContext, resultId: string): Promise<RecheckStatusRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recheck_requests")
    .select("id, exam_paper_id, status")
    .eq("institution_id", ctx.institution.id)
    .eq("result_id", resultId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((row) => ({ requestId: row.id, examPaperId: row.exam_paper_id, status: row.status }));
}

export interface RecheckQueueRow {
  id: string;
  status: string;
  reason: string;
  requestedAt: string;
  resultId: string;
  examPaperId: string;
  examId: string;
  studentId: string;
  maxMarks: number;
  studentName: string;
  subjectName: string;
  examName: string;
}

interface RecheckQueueJoinRow {
  id: string;
  status: string;
  reason: string;
  created_at: string;
  result_id: string;
  exam_paper_id: string;
  results: {
    student_id: string;
    exam_id: string;
    students: { first_name: string; last_name: string | null } | null;
    exams: { name: string } | null;
  } | null;
  exam_papers: { max_marks: number; subjects: { name: string } | null } | null;
}

const RECHECK_QUEUE_SELECT =
  "id, status, reason, created_at, result_id, exam_paper_id, results(student_id, exam_id, students(first_name, last_name), exams(name)), exam_papers(max_marks, subjects(name))";

function toQueueRow(row: RecheckQueueJoinRow): RecheckQueueRow {
  const student = row.results?.students ?? null;
  return {
    id: row.id,
    status: row.status,
    reason: row.reason,
    requestedAt: row.created_at,
    resultId: row.result_id,
    examPaperId: row.exam_paper_id,
    examId: row.results?.exam_id ?? "",
    studentId: row.results?.student_id ?? "",
    maxMarks: row.exam_papers?.max_marks ?? 0,
    studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
    subjectName: row.exam_papers?.subjects?.name ?? "",
    examName: row.results?.exams?.name ?? "",
  };
}

/** The controller's recheck queue (`/exams/rechecks`), optionally filtered by status. */
export async function listRecheckQueue(ctx: TenantContext, status?: string): Promise<RecheckQueueRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("recheck_requests")
    .select(RECHECK_QUEUE_SELECT)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => toQueueRow(row as unknown as RecheckQueueJoinRow));
}

export async function getRecheck(ctx: TenantContext, requestId: string): Promise<RecheckQueueRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recheck_requests")
    .select(RECHECK_QUEUE_SELECT)
    .eq("id", requestId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return toQueueRow(data as unknown as RecheckQueueJoinRow);
}

// T-0NN — result remarks (07 §2.2). Pure RLS scope (0047
// result_remarks_select), same shape as getCurrentResult: a caller outside
// the row's scope simply gets no row back.
export async function getResultRemark(ctx: TenantContext, resultId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("result_remarks")
    .select("remark")
    .eq("institution_id", ctx.institution.id)
    .eq("result_id", resultId)
    .maybeSingle();
  if (error) throw error;
  return data?.remark ?? null;
}

// dashboard — T-039.

export interface ExamGradeDistribution {
  examId: string;
  examName: string;
  distribution: Record<string, number>;
  total: number;
}

/**
 * Grade distribution for one exam — defaults to the most recently published
 * exam when `examId` is omitted. Selects only the `grade` column (never the
 * full result row listResultsForExam fetches): Postgrest has no `GROUP BY`,
 * so counting per grade still happens in JS over that one column. At demo
 * scale (a few thousand results per exam) that's fine; if an institution's
 * per-exam result count grows far past that, this should become a
 * `select grade, count(*) group by grade` SQL view instead (flagged in the
 * T-039 report rather than added here — P-01 owns migrations).
 */
export async function examGradeDistribution(ctx: TenantContext, examId?: string): Promise<ExamGradeDistribution | null> {
  const supabase = await createClient();

  let resolvedExamId = examId;
  let examName = "";
  if (resolvedExamId) {
    const { data: exam, error: examError } = await supabase
      .from("exams")
      .select("name")
      .eq("id", resolvedExamId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (examError) throw examError;
    if (!exam) return null;
    examName = exam.name;
  } else {
    const { data: exam, error: examError } = await supabase
      .from("exams")
      .select("id, name")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "published")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (examError) throw examError;
    if (!exam) return null;
    resolvedExamId = exam.id;
    examName = exam.name;
  }

  // Paged: one PostgREST response stops at 1,000 rows, which capped a 3,024-student exam at "1,000".
  const data: { grade: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await supabase
      .from("results")
      .select("id, grade")
      .eq("institution_id", ctx.institution.id)
      .eq("exam_id", resolvedExamId)
      .is("superseded_by", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    data.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }

  const distribution: Record<string, number> = {};
  for (const row of data) {
    distribution[row.grade] = (distribution[row.grade] ?? 0) + 1;
  }

  return { examId: resolvedExamId, examName, distribution, total: data?.length ?? 0 };
}

export interface StudentUpcomingExamPaper {
  examId: string;
  examName: string;
  paperId: string;
  subjectName: string;
  scheduledAt: string;
  durationMinutes: number;
}

/**
 * Scheduled papers (next 60 days, non-draft exams) for one student's active
 * section. Students and guardians cannot read exams under RLS, so this calls
 * the definer RPC `my_upcoming_exam_papers`, which returns rows only for the
 * student themself or a linked guardian.
 */
export async function upcomingExamsForStudent(
  _ctx: TenantContext,
  studentId: string,
  days = 60,
): Promise<StudentUpcomingExamPaper[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_upcoming_exam_papers", { p_student_id: studentId, p_days: days });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    examId: r.exam_id,
    examName: r.exam_name,
    paperId: r.paper_id,
    subjectName: r.subject_name,
    scheduledAt: r.scheduled_at,
    durationMinutes: r.duration_minutes,
  }));
}


export interface SectionScoreBand {
  /** e.g. "X-A". */
  section: string;
  grade: string;
  /** Students in this section with a result in the exam. */
  students: number;
  /** Of them, how many scored below the threshold. */
  below: number;
  averagePercent: number;
}

/**
 * One exam's results class by class: how many students scored below a threshold (default 70%) and the
 * average, for the latest published exam unless one is named. Counts only; sections the caller cannot
 * see results for are left out (a teacher sees their own), never shown as zero. Paged past 1,000 rows.
 */
export async function sectionScoreBands(ctx: TenantContext, opts: { examId?: string; belowPercent?: number } = {}): Promise<{ exam: string; threshold: number; sections: SectionScoreBand[] } | null> {
  const supabase = await createClient();
  const threshold = opts.belowPercent ?? 70;
  const examQuery = supabase.from("exams").select("id, name").eq("institution_id", ctx.institution.id);
  const { data: exam, error: examError } = opts.examId
    ? await examQuery.eq("id", opts.examId).maybeSingle()
    : await examQuery.eq("status", "published").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (examError) throw examError;
  if (!exam) return null;

  const pct = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("results")
      .select("id, student_id, percentage")
      .eq("institution_id", ctx.institution.id)
      .eq("exam_id", exam.id)
      .is("superseded_by", null)
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) if (r.percentage !== null) pct.set(r.student_id, Number(r.percentage));
    if (!data || data.length < 1000) break;
  }
  const { data: year, error: yearError } = await supabase.from("academic_years").select("id").eq("institution_id", ctx.institution.id).eq("is_current", true).maybeSingle();
  if (yearError) throw yearError;
  const sectionOf = new Map<string, string>();
  for (let from = 0; year; from += 1000) {
    const { data, error } = await supabase
      .from("enrolments")
      .select("id, student_id, class_section_id")
      .eq("institution_id", ctx.institution.id)
      .eq("academic_year_id", year.id)
      .eq("status", "active")
      .order("id")
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) sectionOf.set(r.student_id, r.class_section_id);
    if (!data || data.length < 1000) break;
  }
  const bySection = new Map<string, number[]>();
  for (const [student, p] of pct) {
    const sec = sectionOf.get(student);
    if (sec) bySection.set(sec, [...(bySection.get(sec) ?? []), p]);
  }
  if (bySection.size === 0) return { exam: exam.name, threshold, sections: [] };
  const { data: sections, error } = await supabase.from("class_sections").select("id, name, grades(code, display_name, sort_key)").in("id", [...bySection.keys()]);
  if (error) throw error;
  type G = { code: string; display_name: string; sort_key: number } | null;
  return {
    exam: exam.name,
    threshold,
    sections: (sections ?? [])
      .map((s) => ({ g: s.grades as G, name: s.name, scores: bySection.get(s.id) ?? [] }))
      .sort((a, b) => (a.g?.sort_key ?? 0) - (b.g?.sort_key ?? 0) || a.name.localeCompare(b.name))
      .map((x) => ({
        section: `${x.g?.code ?? "?"}-${x.name}`,
        grade: x.g?.display_name ?? "",
        students: x.scores.length,
        below: x.scores.filter((v) => v < threshold).length,
        averagePercent: Math.round((x.scores.reduce((a, b) => a + b, 0) / Math.max(1, x.scores.length)) * 10) / 10,
      })),
  };
}
