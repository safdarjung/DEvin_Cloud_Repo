import "server-only";
// M11-T8 — questionBank.list read. RLS (0073) already scopes rows (owner/
// principal/exam_controller: all; teacher: taught (grade, subject) pairs
// only); institution_id filter below is defense in depth, same shape as
// every other queries.ts in this codebase. Paging mirrors
// core/audit.queries.ts's listAuditEvents.
import { createClient } from "@/lib/supabase/server";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { listCurriculumUnitsForGrades, listTeachableSections } from "@/modules/academics/assignments.queries";
import { listTopics } from "@/modules/academics/curriculum.queries";
import { managesWholeSection } from "@/modules/academics/teacher-scope";
import type { PairMeta } from "@/modules/question-bank/components/question-meta";
import { textbooksForGrade } from "@/modules/textbooks/queries";
import type {
  Difficulty,
  PaperDraftInput,
  QuestionListInput,
  QuestionOrigin,
  QuestionStatus,
  QuestionType,
} from "@/modules/question-bank/schemas";

export interface QuestionBankItem {
  id: string;
  subjectId: string;
  subjectName: string;
  gradeId: string;
  gradeCode: string;
  curriculumUnitId: string | null;
  unitTitle: string | null;
  type: QuestionType;
  difficulty: Difficulty;
  body: string;
  /** string[] for mcq/multi_select, {left,right} for match, {assertion,reason} for assertion_reason, else null. */
  options: string[] | { left: string[]; right: string[] } | { assertion: string; reason: string } | null;
  answer: string;
  answerKey: unknown;
  marks: number;
  isActive: boolean;
  /** Students may see it in self-practice (0151). */
  practiceAllowed: boolean;
  status: QuestionStatus;
  origin: QuestionOrigin;
  aiModel: string | null;
  curriculumTopicId: string | null;
  topicTitle: string | null;
  explanation: string | null;
  markingScheme: string | null;
  learningOutcome: string | null;
  sourceSubjectTextbookId: string | null;
  sourceChapterNo: number | null;
  sourcePage: number | null;
  version: number;
  parentQuestionId: string | null;
  stemQuestionId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdBy: string;
  updatedAt: string;
}

export interface QuestionListResult {
  items: QuestionBankItem[];
  total: number;
}

const QUESTION_SELECT =
  "id, subject_id, grade_id, curriculum_unit_id, curriculum_topic_id, type, difficulty, body, options, answer, answer_key, marks, is_active, practice_allowed, status, origin, ai_model, explanation, marking_scheme, learning_outcome, source_subject_textbook_id, source_chapter_no, source_page, version, parent_question_id, stem_question_id, reviewed_by, reviewed_at, review_note, created_by, updated_at, subjects(name), grades(code), curriculum_units(title), curriculum_topics(title)";

type ServerClient = Awaited<ReturnType<typeof createClient>>;
const selectQuestions = (supabase: ServerClient) => supabase.from("question_bank").select(QUESTION_SELECT, { count: "exact" });
type QuestionRow = NonNullable<Awaited<ReturnType<typeof selectQuestions>>["data"]>[number];

function toItem(row: QuestionRow): QuestionBankItem {
    const subject = row.subjects as { name: string } | null;
    const grade = row.grades as { code: string } | null;
    const unit = row.curriculum_units as { title: string } | null;
    const topic = row.curriculum_topics as { title: string } | null;
    return {
      id: row.id as string,
      subjectId: row.subject_id as string,
      subjectName: subject?.name ?? "",
      gradeId: row.grade_id as string,
      gradeCode: grade?.code ?? "",
      curriculumUnitId: (row.curriculum_unit_id as string | null) ?? null,
      unitTitle: unit?.title ?? null,
      type: row.type as QuestionType,
      difficulty: row.difficulty as Difficulty,
      body: row.body as string,
      options: (row.options as QuestionBankItem["options"]) ?? null,
      answer: row.answer as string,
      answerKey: row.answer_key,
      marks: row.marks as number,
      isActive: row.is_active as boolean,
      practiceAllowed: row.practice_allowed,
      status: row.status as QuestionStatus,
      origin: row.origin as QuestionOrigin,
      aiModel: row.ai_model,
      curriculumTopicId: row.curriculum_topic_id,
      topicTitle: topic?.title ?? null,
      explanation: row.explanation,
      markingScheme: row.marking_scheme,
      learningOutcome: row.learning_outcome,
      sourceSubjectTextbookId: row.source_subject_textbook_id,
      sourceChapterNo: row.source_chapter_no,
      sourcePage: row.source_page,
      version: row.version,
      parentQuestionId: row.parent_question_id,
      stemQuestionId: row.stem_question_id,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      reviewNote: row.review_note,
      createdBy: row.created_by as string,
      updatedAt: row.updated_at as string,
    };
  }

export async function listQuestions(ctx: TenantContext, filters: QuestionListInput): Promise<QuestionListResult> {
  const page = filters.page;
  const pageSize = filters.pageSize;
  const offset = (page - 1) * pageSize;

  let query = selectQuestions(await createClient())
    .eq("institution_id", ctx.institution.id)
    .order("updated_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (filters.status) query = query.eq("status", filters.status);
  else if (!filters.includeArchived) query = query.neq("status", "archived");
  if (filters.origin) query = query.eq("origin", filters.origin);
  if (filters.curriculumTopicId) query = query.eq("curriculum_topic_id", filters.curriculumTopicId);
  if (filters.subjectId) query = query.eq("subject_id", filters.subjectId);
  if (filters.gradeId) query = query.eq("grade_id", filters.gradeId);
  if (filters.curriculumUnitId) query = query.eq("curriculum_unit_id", filters.curriculumUnitId);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);

  const { data, error, count } = await query;
  // PGRST103: page past the last row -> empty page, not a 416 throw.
  if (error && error.code !== "PGRST103") throw error;

  return { items: (data ?? []).map(toItem), total: count ?? 0 };
}

export interface TeachingPair {
  gradeId: string;
  gradeCode: string;
  subjectId: string;
  subjectName: string;
}

/** Distinct (grade, subject) pairs the caller may author questions and papers for. Owner/principal get every grade with a section x every subject; approvers (incl. exam controller) also every pair the school teaches: RLS lets them write school-wide. A teacher gets only their subject_assignments pairs, the same set the bank (0073) and paper (0149) RLS accepts; a class teacher's all-subjects reach (diary, lesson plans) does not apply here. */
export async function listTeachingPairs(ctx: TenantContext): Promise<TeachingPair[]> {
  const supabase = await createClient();
  const isApprover = hasPermission(ctx, "question.approve");
  const pairs = new Map<string, { gradeId: string; subjectId: string; subjectName: string }>();
  if (isApprover && managesWholeSection(ctx, null)) {
    // Owner/principal: every grade that has a section x every subject (3 queries, not one per section).
    const [sections, subjects] = await Promise.all([
      listTeachableSections(ctx),
      supabase.from("subjects").select("id, name").eq("institution_id", ctx.institution.id),
    ]);
    if (subjects.error) throw subjects.error;
    for (const gradeId of new Set(sections.map((s) => s.gradeId))) {
      for (const subject of subjects.data ?? []) pairs.set(`${gradeId}:${subject.id}`, { gradeId, subjectId: subject.id, subjectName: subject.name });
    }
  } else if (!ctx.membership.staffId) {
    return [];
  }
  let assigned = supabase
    .from("subject_assignments")
    .select("subject_id, subjects(name), class_sections(grade_id)")
    .eq("institution_id", ctx.institution.id);
  if (!isApprover) assigned = assigned.eq("teacher_id", ctx.membership.staffId!);
  const { data, error: assignedError } = await assigned;
  if (assignedError) throw assignedError;
  for (const row of data ?? []) {
    const gradeId = (row.class_sections as { grade_id: string } | null)?.grade_id;
    if (gradeId) pairs.set(`${gradeId}:${row.subject_id}`, { gradeId, subjectId: row.subject_id, subjectName: (row.subjects as { name: string } | null)?.name ?? "" });
  }
  if (pairs.size === 0) return [];
  const { data: grades, error } = await supabase
    .from("grades")
    .select("id, code, sort_key")
    .eq("institution_id", ctx.institution.id)
    .in("id", [...new Set([...pairs.values()].map((p) => p.gradeId))]);
  if (error) throw error;
  const gradeById = new Map((grades ?? []).map((g) => [g.id, g]));
  return [...pairs.values()]
    .map((p) => ({ ...p, gradeCode: gradeById.get(p.gradeId)?.code ?? "?", sort: gradeById.get(p.gradeId)?.sort_key ?? 0 }))
    .sort((a, b) => a.sort - b.sort || a.subjectName.localeCompare(b.subjectName))
    .map(({ gradeId, gradeCode, subjectId, subjectName }) => ({ gradeId, gradeCode, subjectId, subjectName }));
}

/** Units, topics and books for each pair in a fixed handful of queries (was three per pair: hundreds for leadership, a slow page and refresh). */
export async function listPairMeta(ctx: TenantContext, pairs: TeachingPair[]): Promise<PairMeta[]> {
  const gradeIds = [...new Set(pairs.map((p) => p.gradeId))];
  const [units, topics, bookLists] = await Promise.all([
    listCurriculumUnitsForGrades(ctx, gradeIds),
    pairs.length ? listTopics(ctx, {}) : Promise.resolve([]),
    Promise.all(gradeIds.map((g) => textbooksForGrade(ctx, g))),
  ]);
  const books = new Map(gradeIds.map((g, i) => [g, bookLists[i]]));
  const unitPair = new Map(units.map((u) => [u.id, `${u.gradeId}:${u.subjectId}`]));
  return pairs.map((p) => {
    const key = `${p.gradeId}:${p.subjectId}`;
    return {
      ...p,
      units: units.filter((u) => u.gradeId === p.gradeId && u.subjectId === p.subjectId).map((u) => ({ id: u.id, title: u.title })),
      topics: topics.filter((t) => unitPair.get(t.curriculumUnitId) === key).map((t) => ({ id: t.id, unitId: t.curriculumUnitId, parentId: t.parentId, title: t.title })),
      books: (books.get(p.gradeId)?.[p.subjectId] ?? []).map((b) => ({ id: b.id, title: b.title })),
    };
  });
}

export interface PaperDraftQuestion {
  id: string;
  subjectId: string;
  curriculumUnitId: string | null;
  type: QuestionType;
  difficulty: Difficulty;
  body: string;
  marks: number;
}

export interface PaperDraftResult {
  questions: PaperDraftQuestion[];
  totalMarksRequested: number;
  totalMarksSelected: number;
  note: string;
}

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

/**
 * Deterministic paper draft (AI roles P4, `question_paper` capability): picks
 * active questions from `unitIds` up to `totalMarks`, split across
 * difficulties by `difficultyMix` (default: an even third each). Stable
 * order (sorted by id, no randomness) — no paper table exists, this is a
 * draft to copy/print, never saved.
 */
export async function paperDraft(ctx: TenantContext, input: PaperDraftInput): Promise<PaperDraftResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_bank")
    .select("id, subject_id, curriculum_unit_id, type, difficulty, body, marks")
    .eq("institution_id", ctx.institution.id)
    .eq("is_active", true)
    .in("curriculum_unit_id", input.unitIds)
    .order("id", { ascending: true });
  if (error) throw error;

  const byDifficulty = new Map<Difficulty, NonNullable<typeof data>>();
  for (const d of DIFFICULTIES) byDifficulty.set(d, []);
  for (const row of data ?? []) {
    byDifficulty.get(row.difficulty as Difficulty)?.push(row);
  }

  const mix = input.difficultyMix;
  const targetFor = (d: Difficulty): number => (mix ? input.totalMarks * (mix[d] ?? 0) : input.totalMarks / DIFFICULTIES.length);

  const questions: PaperDraftQuestion[] = [];
  let totalSelected = 0;
  for (const difficulty of DIFFICULTIES) {
    const target = targetFor(difficulty);
    let bucketTotal = 0;
    for (const row of byDifficulty.get(difficulty) ?? []) {
      if (bucketTotal >= target) break;
      if (totalSelected + row.marks > input.totalMarks) continue;
      questions.push({
        id: row.id,
        subjectId: row.subject_id,
        curriculumUnitId: row.curriculum_unit_id,
        type: row.type as QuestionType,
        difficulty,
        body: row.body,
        marks: row.marks,
      });
      bucketTotal += row.marks;
      totalSelected += row.marks;
    }
  }

  return {
    questions,
    totalMarksRequested: input.totalMarks,
    totalMarksSelected: totalSelected,
    note: "Draft only — no paper is saved. Copy or print to use it.",
  };
}

export interface NearDuplicate {
  /** Index into the bodies passed in. */
  inputIndex: number;
  questionId: string;
  body: string;
  similarity: number;
}

/** pg_trgm look-alikes (similarity >= 0.6) in the same grade+subject, under the caller's RLS. Warnings only. */
export async function findNearDuplicates(
  ctx: TenantContext,
  gradeId: string,
  subjectId: string,
  bodies: string[],
  excludeId?: string,
): Promise<NearDuplicate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("question_bank_near_duplicates", {
    p_institution_id: ctx.institution.id,
    p_grade_id: gradeId,
    p_subject_id: subjectId,
    p_bodies: bodies,
    p_exclude_id: excludeId,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({ inputIndex: r.input_index, questionId: r.question_id, body: r.body, similarity: r.similarity }));
}

export interface QuestionCollection {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "school";
  ownerId: string;
  isMine: boolean;
  itemCount: number;
  updatedAt: string;
}

/** The caller's own collections plus every collection shared with the school (RLS). */
export async function listCollections(ctx: TenantContext): Promise<QuestionCollection[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_collections")
    .select("id, name, description, visibility, owner_id, updated_at, question_collection_items(count)")
    .eq("institution_id", ctx.institution.id)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    visibility: c.visibility as QuestionCollection["visibility"],
    ownerId: c.owner_id,
    isMine: c.owner_id === ctx.user.id,
    itemCount: (c.question_collection_items as unknown as { count: number }[])[0]?.count ?? 0,
    updatedAt: c.updated_at,
  }));
}

export interface CollectionItem {
  questionId: string;
  position: number;
  /** null when the question is outside the caller's question_bank scope (RLS). */
  question: QuestionBankItem | null;
}

/** Items of a visible collection. Question rows come through listQuestions' RLS, so a teacher never sees an untaught question's text. */
export async function listCollectionItems(ctx: TenantContext, collectionId: string): Promise<CollectionItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_collection_items")
    .select("question_id, position")
    .eq("institution_id", ctx.institution.id)
    .eq("collection_id", collectionId)
    .order("position")
    .order("created_at");
  if (error) throw error;
  const ids = (data ?? []).map((r) => r.question_id);
  const questions = ids.length === 0 ? [] : await questionsByIds(ctx, ids);
  const byId = new Map(questions.map((q) => [q.id, q]));
  return (data ?? []).map((r) => ({ questionId: r.question_id, position: r.position, question: byId.get(r.question_id) ?? null }));
}

async function questionsByIds(ctx: TenantContext, ids: string[]): Promise<QuestionBankItem[]> {
  const { data, error } = await selectQuestions(await createClient()).eq("institution_id", ctx.institution.id).in("id", ids);
  if (error) throw error;
  return (data ?? []).map(toItem);
}
