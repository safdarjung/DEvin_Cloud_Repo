import "server-only";
// Phase 4 — online test reads. Staff reads run under RLS (0150): leadership
// sees the school's tests, a teacher the tests of their taught (grade,
// subject) pairs and the attempts of sections they teach. Student and
// guardian reads go only through definer RPCs that strip answer keys and
// follow the release policy (get_test_for_attempt, get_test_result,
// my_online_tests). The institution_id filters are defense in depth.
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import {
  answerText,
  computeAnalytics,
  isObjectiveType,
  snapshotItems,
  type SnapshotItem,
  type TestAnalytics,
} from "@/modules/online-tests/marking";
import type { AttemptStatus, ReleasePolicy, TestStatus } from "@/modules/online-tests/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

type Db = Awaited<ReturnType<typeof createClient>>;

export interface TestSummary {
  id: string;
  title: string;
  status: TestStatus;
  questionPaperId: string;
  paperVersionNo: number;
  gradeId: string;
  gradeCode: string;
  subjectId: string;
  subjectName: string;
  sectionIds: string[];
  opensAt: string;
  closesAt: string;
  durationMinutes: number;
  maxAttempts: number;
  shuffle: boolean;
  showResults: ReleasePolicy;
  showAnswers: ReleasePolicy;
  practice: boolean;
  createdBy: string;
  publishedAt: string | null;
  /** Last push to official marks entry (pushToMarksEntry). */
  marksPushedAt: string | null;
}

const TEST_COLUMNS =
  "id, title, status, question_paper_id, paper_version_no, grade_id, subject_id, section_ids, opens_at, closes_at, duration_minutes, max_attempts, shuffle, show_results, show_answers, practice, created_by, published_at, marks_pushed_at, grades(code), subjects(name)";

type TestRow = {
  id: string;
  title: string;
  status: string;
  question_paper_id: string;
  paper_version_no: number;
  grade_id: string;
  subject_id: string;
  section_ids: string[];
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  max_attempts: number;
  shuffle: boolean;
  show_results: string;
  show_answers: string;
  practice: boolean;
  created_by: string;
  published_at: string | null;
  marks_pushed_at: string | null;
  grades: { code: string } | null;
  subjects: { name: string } | null;
};

function toSummary(row: TestRow): TestSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as TestStatus,
    questionPaperId: row.question_paper_id,
    paperVersionNo: row.paper_version_no,
    gradeId: row.grade_id,
    gradeCode: row.grades?.code ?? "",
    subjectId: row.subject_id,
    subjectName: row.subjects?.name ?? "",
    sectionIds: row.section_ids,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    durationMinutes: row.duration_minutes,
    maxAttempts: row.max_attempts,
    shuffle: row.shuffle,
    showResults: row.show_results as ReleasePolicy,
    showAnswers: row.show_answers as ReleasePolicy,
    practice: row.practice,
    createdBy: row.created_by,
    publishedAt: row.published_at,
    marksPushedAt: row.marks_pushed_at,
  };
}

async function loadTestRow(db: Db, ctx: TenantContext, id: string): Promise<TestRow> {
  const { data, error } = await db.from("online_tests").select(TEST_COLUMNS).eq("id", id).eq("institution_id", ctx.institution.id).maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Test not found.");
  return data as unknown as TestRow;
}

async function loadItems(db: Db, test: TestRow): Promise<{ items: SnapshotItem[]; totalMarks: number }> {
  const { data, error } = await db
    .from("question_paper_versions")
    .select("snapshot")
    .eq("paper_id", test.question_paper_id)
    .eq("version_no", test.paper_version_no)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Paper version not found.");
  const totalMarks = Number((data.snapshot as { paper?: { total_marks?: number } } | null)?.paper?.total_marks ?? 0);
  return { items: snapshotItems(data.snapshot), totalMarks };
}

export async function listTests(ctx: TenantContext, input: { status?: TestStatus }): Promise<TestSummary[]> {
  const db = await createClient();
  let q = db.from("online_tests").select(TEST_COLUMNS).eq("institution_id", ctx.institution.id).order("opens_at", { ascending: false }).limit(200);
  if (input.status) q = q.eq("status", input.status);
  const { data, error } = await q;
  if (error) throwMapped(error);
  return (data as unknown as TestRow[]).map(toSummary);
}

export interface TestDetail extends TestSummary {
  attempts: Record<AttemptStatus, number>;
  /** Teacher marks changed after the last push: official marks are stale until pushed again. */
  needsRepush: boolean;
}

export async function getTest(ctx: TenantContext, id: string): Promise<TestDetail> {
  const db = await createClient();
  const row = await loadTestRow(db, ctx, id);
  const { data, error } = await db.from("test_attempts").select("status").eq("test_id", id).eq("institution_id", ctx.institution.id);
  if (error) throwMapped(error);
  const attempts: Record<AttemptStatus, number> = { in_progress: 0, submitted: 0, auto_submitted: 0, evaluated: 0 };
  for (const a of data) attempts[a.status as AttemptStatus] += 1;
  let needsRepush = false;
  if (row.marks_pushed_at) {
    const { data: later, error: lErr } = await db
      .from("test_responses")
      .select("id, test_attempts!inner(test_id)")
      .eq("institution_id", ctx.institution.id)
      .eq("test_attempts.test_id", id)
      .gt("marked_at", row.marks_pushed_at)
      .limit(1);
    if (lErr) throwMapped(lErr);
    needsRepush = later.length > 0;
  }
  return { ...toSummary(row), attempts, needsRepush };
}

// ── Student / guardian (definer RPCs) ──

export interface MyTest {
  testId: string;
  title: string;
  subjectId: string;
  status: TestStatus;
  opensAt: string;
  closesAt: string;
  durationMinutes: number;
  maxAttempts: number;
  practice: boolean;
  attemptsUsed: number;
  openAttemptId: string | null;
  lastAttemptId: string | null;
  lastStatus: AttemptStatus | null;
  resultsReleased: boolean;
}

export async function myTests(ctx: TenantContext): Promise<MyTest[]> {
  const db = await createClient();
  const { data, error } = await db.rpc("my_online_tests", { p_institution_id: ctx.institution.id });
  if (error) throwMapped(error);
  return data as unknown as MyTest[];
}

export interface AttemptPaperItem {
  key: string;
  type: string;
  body: string;
  options: unknown;
  marks: number;
  choiceGroup: number | null;
}

export interface AttemptPaper {
  attempt: {
    id: string;
    attemptNo: number;
    status: AttemptStatus;
    startedAt: string;
    deadline: string;
    submittedAt: string | null;
    /** Server clock at read time: the runner times from deadline - serverNow, never the device clock. */
    serverNow: string;
  };
  test: { id: string; title: string; durationMinutes: number; totalMarks: number; negativeMarking: number; instructions: string | null };
  sections: { id: string; title: string; instructions: string | null; chooseCount: number | null; items: AttemptPaperItem[] }[];
  responses: { itemKey: string; answer: Json; flagged: boolean; savedAt: string }[];
}

export async function getAttemptPaper(_ctx: TenantContext, attemptId: string): Promise<AttemptPaper> {
  const db = await createClient();
  const { data, error } = await db.rpc("get_test_for_attempt", { p_attempt_id: attemptId });
  if (error) throwMapped(error);
  return data as unknown as AttemptPaper;
}

export interface TestResultItem {
  key: string;
  section: string;
  type: string;
  body: string;
  options: unknown;
  marks: number;
  choiceGroup: number | null;
  answer: Json;
  awarded: number | null;
  correct: boolean | null;
  feedback: string | null;
  /** Only when the answer release policy allows (always for staff). */
  correctAnswer: Json;
  explanation: string | null;
}

export interface TestResult {
  attemptId: string;
  testId: string;
  title: string;
  studentId: string;
  status: AttemptStatus;
  submittedAt: string | null;
  totalMarks: number;
  objectiveScore: number | null;
  subjectiveScore: number | null;
  totalScore: number | null;
  answersShown: boolean;
  items: TestResultItem[];
}

export async function testResult(_ctx: TenantContext, attemptId: string): Promise<TestResult> {
  const db = await createClient();
  const { data, error } = await db.rpc("get_test_result", { p_attempt_id: attemptId });
  if (error) throwMapped(error);
  return data as unknown as TestResult;
}

// ── Marking (teacher scope / leadership) ──

export interface QueueAttempt {
  attemptId: string;
  studentId: string;
  studentName: string;
  status: AttemptStatus;
  totalScore: number | null;
  /** Written answers still without teacher marks. */
  pending: number;
}

export interface QueueItem {
  responseId: string;
  attemptId: string;
  itemKey: string;
  type: string;
  body: string;
  marks: number;
  markingScheme: string | null;
  expectedAnswer: string | null;
  answer: string;
  aiSuggestedMarks: number | null;
  aiFeedback: string | null;
  teacherMarks: number | null;
  teacherFeedback: string | null;
}

export interface MarkingQueue {
  test: TestSummary;
  attempts: QueueAttempt[];
  items: QueueItem[];
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

async function loadAttempts(db: Db, ctx: TenantContext, testId: string) {
  const { data, error } = await db
    .from("test_attempts")
    .select("id, student_id, status, total_score, students(first_name, last_name)")
    .eq("test_id", testId)
    .eq("institution_id", ctx.institution.id)
    .neq("status", "in_progress")
    .order("submitted_at");
  if (error) throwMapped(error);
  return data as unknown as {
    id: string;
    student_id: string;
    status: string;
    total_score: number | null;
    students: { first_name: string; last_name: string | null } | null;
  }[];
}

async function loadResponses(db: Db, ctx: TenantContext, attemptIds: string[]) {
  if (attemptIds.length === 0) return [];
  const { data, error } = await db
    .from("test_responses")
    .select("id, attempt_id, item_key, answer, auto_marks, ai_suggested_marks, ai_feedback, teacher_marks, teacher_feedback")
    .eq("institution_id", ctx.institution.id)
    .in("attempt_id", attemptIds);
  if (error) throwMapped(error);
  return data;
}

export async function markingQueue(ctx: TenantContext, testId: string): Promise<MarkingQueue> {
  const db = await createClient();
  const test = await loadTestRow(db, ctx, testId);
  const [{ items }, attempts] = await Promise.all([loadItems(db, test), loadAttempts(db, ctx, testId)]);
  const responses = await loadResponses(db, ctx, attempts.map((a) => a.id));
  const written = new Map(items.filter((i) => !isObjectiveType(i.type)).map((i) => [i.key, i]));

  const queue: QueueItem[] = responses
    .filter((r) => written.has(r.item_key) && answerText(r.answer).trim() !== "")
    .map((r) => {
      const item = written.get(r.item_key) as SnapshotItem;
      return {
        responseId: r.id,
        attemptId: r.attempt_id,
        itemKey: r.item_key,
        type: item.type,
        body: item.body,
        marks: item.marks,
        markingScheme: item.markingScheme,
        expectedAnswer: item.answer,
        answer: answerText(r.answer),
        aiSuggestedMarks: num(r.ai_suggested_marks),
        aiFeedback: r.ai_feedback,
        teacherMarks: num(r.teacher_marks),
        teacherFeedback: r.teacher_feedback,
      };
    });

  return {
    test: toSummary(test),
    attempts: attempts.map((a) => ({
      attemptId: a.id,
      studentId: a.student_id,
      studentName: [a.students?.first_name, a.students?.last_name].filter(Boolean).join(" "),
      status: a.status as AttemptStatus,
      totalScore: num(a.total_score),
      pending: queue.filter((q) => q.attemptId === a.id && q.teacherMarks === null).length,
    })),
    items: queue,
  };
}

/** One queue row (the AI marking route and action read through RLS, like the teacher would). */
export async function queueItem(ctx: TenantContext, responseId: string): Promise<QueueItem & { studentName: string }> {
  const db = await createClient();
  const { data, error } = await db
    .from("test_responses")
    .select("attempt_id, test_attempts(test_id)")
    .eq("id", responseId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throwMapped(error);
  const testId = (data?.test_attempts as unknown as { test_id: string } | null)?.test_id;
  if (!testId) throw new AppError("not_found", "Answer not found among the tests you mark.");
  const queue = await markingQueue(ctx, testId);
  const item = queue.items.find((i) => i.responseId === responseId);
  if (!item) throw new AppError("invalid_state", "Only a submitted written answer can be marked.");
  return { ...item, studentName: queue.attempts.find((a) => a.attemptId === item.attemptId)?.studentName ?? "" };
}

export interface TestAnalyticsResult extends TestAnalytics {
  totalMarks: number;
  items: Pick<SnapshotItem, "key" | "body" | "type" | "marks" | "curriculumUnitId" | "curriculumTopicId">[];
}

export async function testAnalytics(ctx: TenantContext, testId: string): Promise<TestAnalyticsResult> {
  const db = await createClient();
  const test = await loadTestRow(db, ctx, testId);
  const [{ items, totalMarks }, attempts] = await Promise.all([loadItems(db, test), loadAttempts(db, ctx, testId)]);
  const responses = await loadResponses(db, ctx, attempts.map((a) => a.id));
  const stats = computeAnalytics(
    items,
    attempts.map((a) => ({ id: a.id, status: a.status, totalScore: num(a.total_score) })),
    responses.map((r) => ({ attemptId: r.attempt_id, itemKey: r.item_key, answer: r.answer, autoMarks: num(r.auto_marks), teacherMarks: num(r.teacher_marks) })),
  );
  return {
    ...stats,
    totalMarks,
    items: items.map(({ key, body, type, marks, curriculumUnitId, curriculumTopicId }) => ({ key, body, type, marks, curriculumUnitId, curriculumTopicId })),
  };
}
