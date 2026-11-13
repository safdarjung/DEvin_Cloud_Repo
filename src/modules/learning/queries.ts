import "server-only";
// Phase 5 — learning analytics reads. Scope lives in the definer functions of
// migration 0151: section reads need leadership or a teacher of that subject
// in that section; student reads need the student or a linked guardian, and
// show an online test only once its results are released. mastery_snapshots
// and names are read under the caller's own RLS.
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { computeAnalytics, snapshotItems, type TestAnalytics } from "@/modules/online-tests/marking";
import {
  revisionList,
  sectionGaps,
  weakAreas,
  type BankCount,
  type GapRow,
  type LearningNames,
  type MasteryRow,
  type RevisionStudent,
  type TopicRow,
  type WeakArea,
} from "@/modules/learning/recommend";
import type { MyLearningInput, SectionSubjectInput, TestSectionInput } from "@/modules/learning/schemas";

type Db = Awaited<ReturnType<typeof createClient>>;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function ownStudent(ctx: TenantContext, studentId: string | undefined): string {
  const id = studentId ?? ctx.membership.studentId;
  if (!id) throw new AppError("validation_failed", "Choose a student.", { studentId: ["Required."] });
  return id;
}

interface RawTopicRow {
  student_id: string;
  subject_id: string;
  unit_id: string;
  topic_id: string | null;
  items: number;
  awarded: number;
  max_marks: number;
  tests: number;
  practice: number;
  last_on: string | null;
}

const toTopicRow = (r: RawTopicRow): TopicRow => ({
  studentId: r.student_id,
  subjectId: r.subject_id,
  unitId: r.unit_id,
  topicId: r.topic_id,
  items: r.items,
  awarded: Number(r.awarded),
  maxMarks: Number(r.max_marks),
  tests: r.tests,
  practice: r.practice,
  lastOn: r.last_on,
});

async function loadMastery(db: Db, ctx: TenantContext, filter: { studentId?: string; classSectionId?: string; subjectId?: string }): Promise<MasteryRow[]> {
  let q = db
    .from("mastery_snapshots")
    .select("student_id, subject_id, curriculum_unit_id, score, confidence, mark_count, submission_count, test_count, academic_years!inner(is_current)")
    .eq("institution_id", ctx.institution.id)
    .eq("academic_years.is_current", true);
  if (filter.studentId) q = q.eq("student_id", filter.studentId);
  if (filter.classSectionId) q = q.eq("class_section_id", filter.classSectionId);
  if (filter.subjectId) q = q.eq("subject_id", filter.subjectId);
  const { data, error } = await q.limit(5000);
  if (error) throwMapped(error);
  return (data ?? []).map((m) => ({
    studentId: m.student_id,
    subjectId: m.subject_id,
    unitId: m.curriculum_unit_id,
    score: Number(m.score),
    confidence: Number(m.confidence),
    markCount: m.mark_count,
    submissionCount: m.submission_count,
    testCount: m.test_count,
  }));
}

async function loadNames(db: Db, ctx: TenantContext, unitIds: string[]): Promise<LearningNames> {
  const ids = [...new Set(unitIds)];
  if (ids.length === 0) return { units: new Map(), topics: new Map() };
  const [units, topics] = await Promise.all([
    db.from("curriculum_units").select("id, title, subject_id").eq("institution_id", ctx.institution.id).in("id", ids),
    db.from("curriculum_topics").select("id, title, curriculum_unit_id, parent_id").eq("institution_id", ctx.institution.id).in("curriculum_unit_id", ids),
  ]);
  if (units.error) throwMapped(units.error);
  if (topics.error) throwMapped(topics.error);
  return {
    units: new Map((units.data ?? []).map((u) => [u.id, { title: u.title, subjectId: u.subject_id }])),
    topics: new Map((topics.data ?? []).map((t) => [t.id, { title: t.title, unitId: t.curriculum_unit_id, parentId: t.parent_id }])),
  };
}

// ── Student / guardian ──

export interface MyWeakTopics {
  studentId: string;
  areas: WeakArea[];
}

/** Weak topics with evidence and the next practice step. */
export async function myWeakTopics(ctx: TenantContext, input: MyLearningInput): Promise<MyWeakTopics> {
  const studentId = ownStudent(ctx, input.studentId);
  const db = await createClient();
  const [rowsRes, countsRes, mastery] = await Promise.all([
    db.rpc("learning_student_topic_rows", { p_student_id: studentId, p_subject_id: input.subjectId }),
    db.rpc("practice_bank_counts", { p_student_id: studentId }),
    loadMastery(db, ctx, { studentId, subjectId: input.subjectId }),
  ]);
  if (rowsRes.error) throwMapped(rowsRes.error);
  if (countsRes.error) throwMapped(countsRes.error);
  const rows = (rowsRes.data ?? []).map(toTopicRow);
  const counts: BankCount[] = (countsRes.data ?? [])
    .filter((c) => !input.subjectId || c.subject_id === input.subjectId)
    .map((c) => ({ unitId: c.unit_id, topicId: c.topic_id, available: c.available }));
  const names = await loadNames(db, ctx, [...rows.map((r) => r.unitId), ...mastery.map((m) => m.unitId)]);
  return { studentId, areas: weakAreas(rows, mastery, counts, names) };
}

export interface ProgressWeek {
  week: string;
  source: "practice" | "test";
  attempts: number;
  percent: number;
}

/** Weekly practice and test percentages (IST weeks, last year), oldest first. */
export async function myProgress(ctx: TenantContext, input: MyLearningInput): Promise<ProgressWeek[]> {
  const studentId = ownStudent(ctx, input.studentId);
  const db = await createClient();
  const { data, error } = await db.rpc("learning_progress", { p_student_id: studentId, p_subject_id: input.subjectId });
  if (error) throwMapped(error);
  return (data ?? []).map((w) => ({ week: w.week, source: w.source as ProgressWeek["source"], attempts: w.attempts, percent: Number(w.percent) }));
}

export interface PracticeBankCount extends BankCount {
  subjectId: string;
  difficulty: string;
}

/** Approved bank questions a student can practise, per unit / topic / difficulty. */
export async function practiceBankCounts(ctx: TenantContext, input: MyLearningInput): Promise<PracticeBankCount[]> {
  const studentId = ownStudent(ctx, input.studentId);
  const db = await createClient();
  const { data, error } = await db.rpc("practice_bank_counts", { p_student_id: studentId });
  if (error) throwMapped(error);
  return (data ?? [])
    .filter((c) => !input.subjectId || c.subject_id === input.subjectId)
    .map((c) => ({ subjectId: c.subject_id, unitId: c.unit_id, topicId: c.topic_id, difficulty: c.difficulty, available: c.available }));
}

// ── Teacher / leadership ──

async function sectionRows(db: Db, input: SectionSubjectInput): Promise<TopicRow[]> {
  const { data, error } = await db.rpc("learning_section_topic_rows", { p_class_section_id: input.classSectionId, p_subject_id: input.subjectId });
  if (error) throwMapped(error);
  return (data ?? []).map(toTopicRow);
}

/** Chapter and topic gaps of one section in one subject. */
export async function sectionGapsQuery(ctx: TenantContext, input: SectionSubjectInput): Promise<{ units: GapRow[]; topics: GapRow[] }> {
  const db = await createClient();
  const rows = await sectionRows(db, input); // scope check first
  const mastery = await loadMastery(db, ctx, input);
  const names = await loadNames(db, ctx, [...rows.map((r) => r.unitId), ...mastery.map((m) => m.unitId)]);
  return sectionGaps(rows, mastery, names);
}

/** Students of the section who need revision in the subject, with their weak areas. */
export async function revisionListQuery(ctx: TenantContext, input: SectionSubjectInput): Promise<RevisionStudent[]> {
  const db = await createClient();
  const rows = await sectionRows(db, input);
  const mastery = await loadMastery(db, ctx, input);
  const studentIds = [...new Set([...rows.map((r) => r.studentId), ...mastery.map((m) => m.studentId)])];
  const [names, students] = await Promise.all([
    loadNames(db, ctx, [...rows.map((r) => r.unitId), ...mastery.map((m) => m.unitId)]),
    studentIds.length
      ? db.from("students").select("id, first_name, last_name").eq("institution_id", ctx.institution.id).in("id", studentIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string | null }[], error: null }),
  ]);
  if (students.error) throwMapped(students.error);
  const studentNames = new Map((students.data ?? []).map((s) => [s.id, [s.first_name, s.last_name].filter(Boolean).join(" ")]));
  return revisionList(rows, mastery, names, studentNames);
}

/** Question-wise performance and common wrong answers of one test in one section. */
export async function testSectionQuestions(_ctx: TenantContext, input: TestSectionInput): Promise<TestAnalytics> {
  const db = await createClient();
  const { data, error } = await db.rpc("learning_test_section_rows", { p_test_id: input.testId, p_class_section_id: input.classSectionId });
  if (error) throwMapped(error);
  const raw = data as unknown as {
    snapshot: unknown;
    attempts: { id: string; status: string; totalScore: number | null }[];
    responses: { attemptId: string; itemKey: string; answer: unknown; autoMarks: number | null; teacherMarks: number | null }[];
  };
  const num = (v: number | null) => (v === null ? null : Number(v));
  return computeAnalytics(
    snapshotItems(raw.snapshot),
    raw.attempts.map((a) => ({ ...a, totalScore: num(a.totalScore) })),
    raw.responses.map((r) => ({ ...r, autoMarks: num(r.autoMarks), teacherMarks: num(r.teacherMarks) })),
  );
}
