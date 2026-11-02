import "server-only";
// M09-T6 — assignment.read reads for the submission roster (teacher/owner/
// principal/admin) and the student/guardian "my submissions" view. Always
// the signed-in user's RLS client; RLS (0071 assignment_submissions_select,
// documents_select) is the actual filter — explicit institution_id filters
// below are defense in depth, same shape as assignments.queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { listStudentAssignments } from "./assignments.queries";

export type SubmissionState = "not_submitted" | "submitted" | "graded";

interface SubmissionFields {
  submissionId: string | null;
  state: SubmissionState;
  attempt: number;
  submittedAt: string | null;
  isLate: boolean;
  content: Json | null;
  score: number | null;
  maxScore: number | null;
  feedback: string | null;
  gradedAt: string | null;
  documentCount: number;
}

interface SubmissionRow {
  id: string;
  assignment_id: string;
  student_id: string;
  status: string;
  attempt: number;
  submitted_at: string;
  is_late: boolean;
  content: Json | null;
  score: number | null;
  max_score: number | null;
  feedback: string | null;
  graded_at: string | null;
}

/** A student who has not submitted is flagged late once `dueAt` has passed (rulings, "Late flag" — queries mirror submit_assignment's own `now() > due_at`). */
function emptySubmission(dueAt: string | null): SubmissionFields {
  return {
    submissionId: null,
    state: "not_submitted",
    attempt: 0,
    submittedAt: null,
    isLate: dueAt !== null && new Date(dueAt).getTime() < Date.now(),
    content: null,
    score: null,
    maxScore: null,
    feedback: null,
    gradedAt: null,
    documentCount: 0,
  };
}

function toSubmissionFields(row: SubmissionRow, documentCount: number): SubmissionFields {
  return {
    submissionId: row.id,
    state: row.status as SubmissionState,
    attempt: row.attempt,
    submittedAt: row.submitted_at,
    isLate: row.is_late,
    content: row.content,
    score: row.score,
    maxScore: row.max_score,
    feedback: row.feedback,
    gradedAt: row.graded_at,
    documentCount,
  };
}

/** Active `submission` document counts, keyed by submission id — one `.in()` query (no N+1). */
async function documentCountsFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  institutionId: string,
  submissionIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (submissionIds.length === 0) return counts;
  const { data, error } = await supabase
    .from("documents")
    .select("entity_id")
    .eq("institution_id", institutionId)
    .eq("entity_type", "submission")
    .eq("status", "active")
    .in("entity_id", submissionIds);
  if (error) throw error;
  for (const row of data ?? []) {
    counts.set(row.entity_id, (counts.get(row.entity_id) ?? 0) + 1);
  }
  return counts;
}

export interface SubmissionRosterRow extends SubmissionFields {
  studentId: string;
  studentName: string;
  rollNo: number | null;
}

/**
 * The grading roster for one assignment (06 §W6): one row per active
 * enrolment of the assignment's section — whichever ones RLS lets this
 * caller see — left-joined with that student's submission, if any.
 */
export async function submissionsForAssignment(ctx: TenantContext, assignmentId: string): Promise<SubmissionRosterRow[]> {
  const supabase = await createClient();

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, class_section_id, due_at")
    .eq("id", assignmentId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (assignmentError) throw assignmentError;
  if (!assignment) return [];

  const { data: enrolments, error: enrolError } = await supabase
    .from("enrolments")
    .select("student_id, roll_no, students(first_name, last_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("class_section_id", assignment.class_section_id)
    .eq("status", "active")
    .order("roll_no", { ascending: true, nullsFirst: false });
  if (enrolError) throw enrolError;

  const { data: submissions, error: submissionsError } = await supabase
    .from("assignment_submissions")
    .select("id, assignment_id, student_id, status, attempt, submitted_at, is_late, content, score, max_score, feedback, graded_at")
    .eq("institution_id", ctx.institution.id)
    .eq("assignment_id", assignmentId);
  if (submissionsError) throw submissionsError;

  const byStudent = new Map<string, SubmissionRow>();
  for (const row of submissions ?? []) {
    byStudent.set(row.student_id, row as SubmissionRow);
  }
  const counts = await documentCountsFor(
    supabase,
    ctx.institution.id,
    (submissions ?? []).map((row) => row.id),
  );

  return (enrolments ?? []).map((e) => {
    const student = e.students as { first_name: string; last_name: string | null } | null;
    const row = byStudent.get(e.student_id);
    return {
      studentId: e.student_id,
      studentName: [student?.first_name, student?.last_name].filter(Boolean).join(" "),
      rollNo: e.roll_no,
      ...(row ? toSubmissionFields(row, counts.get(row.id) ?? 0) : emptySubmission(assignment.due_at)),
    };
  });
}

export interface MySubmissionRow extends SubmissionFields {
  assignmentId: string;
  title: string;
  subjectId: string;
  dueAt: string | null;
}

/**
 * "My assignments" portal view (06 §W6): every published assignment visible
 * to this student (reuses listStudentAssignments), left-joined with that
 * student's own submission, if any. `studentId` defaults to the caller's own
 * student id; a guardian passes their child's id explicitly.
 */
export async function mySubmissions(ctx: TenantContext, studentId?: string): Promise<MySubmissionRow[]> {
  const resolvedStudentId = studentId ?? ctx.membership.studentId ?? null;
  if (!resolvedStudentId) return [];

  const assignments = await listStudentAssignments(ctx, resolvedStudentId);
  if (assignments.length === 0) return [];

  const supabase = await createClient();
  const { data: submissions, error } = await supabase
    .from("assignment_submissions")
    .select("id, assignment_id, student_id, status, attempt, submitted_at, is_late, content, score, max_score, feedback, graded_at")
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", resolvedStudentId)
    .in(
      "assignment_id",
      assignments.map((a) => a.id),
    );
  if (error) throw error;

  const byAssignment = new Map<string, SubmissionRow>();
  for (const row of submissions ?? []) {
    byAssignment.set(row.assignment_id, row as SubmissionRow);
  }
  const counts = await documentCountsFor(
    supabase,
    ctx.institution.id,
    (submissions ?? []).map((row) => row.id),
  );

  return assignments.map((a) => {
    const row = byAssignment.get(a.id);
    return {
      assignmentId: a.id,
      title: a.title,
      subjectId: a.subjectId,
      dueAt: a.dueAt,
      ...(row ? toSubmissionFields(row, counts.get(row.id) ?? 0) : emptySubmission(a.dueAt)),
    };
  });
}
