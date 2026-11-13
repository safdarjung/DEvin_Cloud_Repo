import "server-only";
// Phase 3 — question paper reads. RLS (0149) scopes every row: leadership
// sees the school's papers, a teacher the papers of the (grade, subject)
// pairs they teach; students/guardians have no policy. The institution_id
// filters below are defense in depth.
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { Difficulty, QuestionType } from "@/modules/question-bank/schemas";
import type { Blueprint, PaperListInput, PaperStatus, TemplateListInput } from "@/modules/question-papers/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface PaperSummary {
  id: string;
  title: string;
  status: PaperStatus;
  academicYearId: string;
  gradeId: string;
  gradeCode: string;
  subjectId: string;
  subjectName: string;
  sectionId: string | null;
  examId: string | null;
  examName: string | null;
  examPaperId: string | null;
  examType: string | null;
  examDate: string | null;
  totalMarks: number;
  currentVersion: number;
  revisionOfId: string | null;
  createdBy: string;
  updatedAt: string;
}

export interface PaperItem {
  id: string;
  sectionId: string;
  position: number;
  sourceQuestionId: string | null;
  type: QuestionType;
  body: string;
  /** string[] for mcq/multi_select, {left,right} for match, {assertion,reason} for assertion_reason, else null. */
  options: unknown;
  answer: string | null;
  answerKey: unknown;
  marks: number;
  explanation: string | null;
  markingScheme: string | null;
  difficulty: Difficulty;
  curriculumUnitId: string | null;
  curriculumTopicId: string | null;
  sourceSubjectTextbookId: string | null;
  sourceChapterNo: number | null;
  sourcePage: number | null;
  choiceGroup: number | null;
  /** Bank stem (passage / case) the source question belongs to; print keeps it after that stem. */
  stemSourceId?: string | null;
}

export interface PaperSection {
  id: string;
  title: string;
  instructions: string | null;
  position: number;
  chooseCount: number | null;
  items: PaperItem[];
}

export interface PaperDetail extends PaperSummary {
  passMarks: number;
  durationMinutes: number | null;
  instructions: string | null;
  negativeMarking: number;
  blueprint: Blueprint | null;
  templateId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  publishedAt: string | null;
  sections: PaperSection[];
}

export interface PaperValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  computedTotal: number;
}

const PAPER_SELECT =
  "id, title, status, academic_year_id, grade_id, subject_id, section_id, exam_id, exam_paper_id, exam_type, exam_date, total_marks, pass_marks, duration_minutes, instructions, negative_marking, blueprint, template_id, revision_of_id, current_version, created_by, approved_by, approved_at, published_at, updated_at, grades(code), subjects(name), exams(name)";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const selectPapers = (supabase: ServerClient) => supabase.from("question_papers").select(PAPER_SELECT, { count: "exact" });
type PaperRow = NonNullable<Awaited<ReturnType<typeof selectPapers>>["data"]>[number];

function toSummary(row: PaperRow): PaperSummary {
  return {
    id: row.id,
    title: row.title,
    status: row.status as PaperStatus,
    academicYearId: row.academic_year_id,
    gradeId: row.grade_id,
    gradeCode: (row.grades as { code: string } | null)?.code ?? "",
    subjectId: row.subject_id,
    subjectName: (row.subjects as { name: string } | null)?.name ?? "",
    sectionId: row.section_id,
    examId: row.exam_id,
    examName: (row.exams as { name: string } | null)?.name ?? null,
    examPaperId: row.exam_paper_id,
    examType: row.exam_type,
    examDate: row.exam_date,
    totalMarks: Number(row.total_marks),
    currentVersion: row.current_version,
    revisionOfId: row.revision_of_id,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

export async function listPapers(ctx: TenantContext, input: PaperListInput): Promise<{ items: PaperSummary[]; total: number }> {
  const supabase = await createClient();
  let query = selectPapers(supabase).eq("institution_id", ctx.institution.id);
  if (input.gradeId) query = query.eq("grade_id", input.gradeId);
  if (input.subjectId) query = query.eq("subject_id", input.subjectId);
  if (input.examId) query = query.eq("exam_id", input.examId);
  query = input.status ? query.eq("status", input.status) : query.neq("status", "archived");
  const from = (input.page - 1) * input.pageSize;
  const { data, error, count } = await query.order("updated_at", { ascending: false }).range(from, from + input.pageSize - 1);
  if (error) throwMapped(error);
  return { items: (data ?? []).map(toSummary), total: count ?? 0 };
}

const ITEM_SELECT =
  "id, section_id, position, source_question_id, type, body, options, answer, answer_key, marks, explanation, marking_scheme, difficulty, curriculum_unit_id, curriculum_topic_id, source_subject_textbook_id, source_chapter_no, source_page, choice_group, question_bank(stem_question_id)";

export async function getPaper(ctx: TenantContext, id: string): Promise<PaperDetail | null> {
  const supabase = await createClient();
  const [paper, sections, items] = await Promise.all([
    selectPapers(supabase).eq("id", id).eq("institution_id", ctx.institution.id).maybeSingle(),
    supabase
      .from("question_paper_sections")
      .select("id, title, instructions, position, choose_count")
      .eq("paper_id", id)
      .eq("institution_id", ctx.institution.id)
      .order("position")
      .order("id"),
    supabase
      .from("question_paper_items")
      .select(ITEM_SELECT)
      .eq("paper_id", id)
      .eq("institution_id", ctx.institution.id)
      .order("position")
      .order("id"),
  ]);
  for (const r of [paper, sections, items]) if (r.error) throwMapped(r.error);
  if (!paper.data) return null;
  const row = paper.data;
  const allItems: PaperItem[] = (items.data ?? []).map((i) => ({
    id: i.id,
    sectionId: i.section_id,
    position: i.position,
    sourceQuestionId: i.source_question_id,
    type: i.type as QuestionType,
    body: i.body,
    options: i.options,
    answer: i.answer,
    answerKey: i.answer_key,
    marks: Number(i.marks),
    explanation: i.explanation,
    markingScheme: i.marking_scheme,
    difficulty: i.difficulty as Difficulty,
    curriculumUnitId: i.curriculum_unit_id,
    curriculumTopicId: i.curriculum_topic_id,
    sourceSubjectTextbookId: i.source_subject_textbook_id,
    sourceChapterNo: i.source_chapter_no,
    sourcePage: i.source_page,
    choiceGroup: i.choice_group,
    stemSourceId: i.question_bank?.stem_question_id ?? null,
  }));
  return {
    ...toSummary(row),
    passMarks: Number(row.pass_marks),
    durationMinutes: row.duration_minutes,
    instructions: row.instructions,
    negativeMarking: Number(row.negative_marking),
    blueprint: row.blueprint as Blueprint | null,
    templateId: row.template_id,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    publishedAt: row.published_at,
    sections: (sections.data ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      instructions: s.instructions,
      position: s.position,
      chooseCount: s.choose_count,
      items: allItems.filter((i) => i.sectionId === s.id),
    })),
  };
}

export async function validatePaper(ctx: TenantContext, id: string): Promise<PaperValidation> {
  const supabase = await createClient();
  const { data: paper, error: findError } = await supabase
    .from("question_papers")
    .select("id")
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (findError) throwMapped(findError);
  if (!paper) throw new AppError("not_found", "Paper not found.");
  const { data, error } = await supabase.rpc("validate_question_paper", { p_paper_id: id });
  if (error) throwMapped(error);
  const v = data as { ok: boolean; errors: string[]; warnings: string[]; computedTotal: number };
  return { ok: v.ok, errors: v.errors, warnings: v.warnings, computedTotal: Number(v.computedTotal) };
}

export interface PaperTemplate {
  id: string;
  name: string;
  gradeId: string | null;
  subjectId: string | null;
  examType: string | null;
  durationMinutes: number | null;
  instructions: string | null;
  blueprint: Blueprint;
  createdBy: string;
  updatedAt: string;
}

export async function listTemplates(ctx: TenantContext, input: TemplateListInput): Promise<PaperTemplate[]> {
  const supabase = await createClient();
  let query = supabase
    .from("question_paper_templates")
    .select("id, name, grade_id, subject_id, exam_type, duration_minutes, instructions, blueprint, created_by, updated_at")
    .eq("institution_id", ctx.institution.id);
  // A template with no grade/subject fits every class.
  if (input.gradeId) query = query.or(`grade_id.is.null,grade_id.eq.${input.gradeId}`);
  if (input.subjectId) query = query.or(`subject_id.is.null,subject_id.eq.${input.subjectId}`);
  const { data, error } = await query.order("name").limit(200);
  if (error) throwMapped(error);
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    gradeId: t.grade_id,
    subjectId: t.subject_id,
    examType: t.exam_type,
    durationMinutes: t.duration_minutes,
    instructions: t.instructions,
    blueprint: t.blueprint as Blueprint,
    createdBy: t.created_by,
    updatedAt: t.updated_at,
  }));
}

export interface WhereUsedRow {
  paperId: string;
  title: string;
  status: PaperStatus;
  examDate: string | null;
  itemId: string;
}

/** Usage history of one bank question, derived from paper items (Phase 1 deferred this; not stored twice). */
export async function whereUsed(ctx: TenantContext, questionId: string): Promise<WhereUsedRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_paper_items")
    .select("id, question_papers(id, title, status, exam_date)")
    .eq("source_question_id", questionId)
    .eq("institution_id", ctx.institution.id)
    .limit(200);
  if (error) throwMapped(error);
  return (data ?? []).flatMap((row) => {
    const p = row.question_papers as { id: string; title: string; status: string; exam_date: string | null } | null;
    return p ? [{ paperId: p.id, title: p.title, status: p.status as PaperStatus, examDate: p.exam_date, itemId: row.id }] : [];
  });
}

export interface PaperVersion {
  versionNo: number;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export async function listVersions(ctx: TenantContext, paperId: string): Promise<PaperVersion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_paper_versions")
    .select("version_no, reason, created_by, created_at")
    .eq("paper_id", paperId)
    .eq("institution_id", ctx.institution.id)
    .order("version_no", { ascending: false });
  if (error) throwMapped(error);
  return (data ?? []).map((v) => ({ versionNo: v.version_no, reason: v.reason, createdBy: v.created_by, createdAt: v.created_at }));
}
