import "server-only";
// M11-T8 — questionBank.list read. RLS (0073) already scopes rows (owner/
// principal/exam_controller: all; teacher: taught (grade, subject) pairs
// only); institution_id filter below is defense in depth, same shape as
// every other queries.ts in this codebase. Paging mirrors
// core/audit.queries.ts's listAuditEvents.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { listSectionSubjects, listTeachableSections } from "@/modules/academics/assignments.queries";
import type { Difficulty, PaperDraftInput, QuestionListInput, QuestionType } from "@/modules/question-bank/schemas";

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
  options: string[] | null;
  answer: string;
  marks: number;
  isActive: boolean;
  createdBy: string;
  updatedAt: string;
}

export interface QuestionListResult {
  items: QuestionBankItem[];
  total: number;
}

export async function listQuestions(ctx: TenantContext, filters: QuestionListInput): Promise<QuestionListResult> {
  const supabase = await createClient();

  const page = filters.page;
  const pageSize = filters.pageSize;
  const offset = (page - 1) * pageSize;

  let query = supabase
    .from("question_bank")
    .select(
      "id, subject_id, grade_id, curriculum_unit_id, type, difficulty, body, options, answer, marks, is_active, created_by, updated_at, subjects(name), grades(code), curriculum_units(title)",
      { count: "exact" },
    )
    .eq("institution_id", ctx.institution.id)
    .order("updated_at", { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (!filters.includeArchived) query = query.eq("is_active", true);
  if (filters.subjectId) query = query.eq("subject_id", filters.subjectId);
  if (filters.gradeId) query = query.eq("grade_id", filters.gradeId);
  if (filters.curriculumUnitId) query = query.eq("curriculum_unit_id", filters.curriculumUnitId);
  if (filters.type) query = query.eq("type", filters.type);
  if (filters.difficulty) query = query.eq("difficulty", filters.difficulty);

  const { data, error, count } = await query;
  // PGRST103: page past the last row -> empty page, not a 416 throw.
  if (error && error.code !== "PGRST103") throw error;

  const items: QuestionBankItem[] = (data ?? []).map((row) => {
    const subject = row.subjects as { name: string } | null;
    const grade = row.grades as { code: string } | null;
    const unit = row.curriculum_units as { title: string } | null;
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
      options: (row.options as string[] | null) ?? null,
      answer: row.answer as string,
      marks: row.marks as number,
      isActive: row.is_active as boolean,
      createdBy: row.created_by as string,
      updatedAt: row.updated_at as string,
    };
  });

  return { items, total: count ?? 0 };
}

export interface TeachingPair {
  gradeId: string;
  gradeCode: string;
  subjectId: string;
  subjectName: string;
}

/** Distinct (grade, subject) pairs the caller may author questions for: their taught sections' grades x subjects (owner/principal: all). RLS on question_bank re-checks on write. */
export async function listTeachingPairs(ctx: TenantContext): Promise<TeachingPair[]> {
  const sections = await listTeachableSections(ctx);
  if (sections.length === 0) return [];
  const supabase = await createClient();
  const { data: grades, error } = await supabase
    .from("grades")
    .select("id, code, sort_key")
    .eq("institution_id", ctx.institution.id)
    .in("id", [...new Set(sections.map((s) => s.gradeId))]);
  if (error) throw error;
  const gradeById = new Map((grades ?? []).map((g) => [g.id, g]));
  const subjectLists = await Promise.all(sections.map((s) => listSectionSubjects(ctx, s.id)));

  const pairs = new Map<string, TeachingPair & { sort: number }>();
  sections.forEach((section, i) => {
    const grade = gradeById.get(section.gradeId);
    for (const subject of subjectLists[i]) {
      pairs.set(`${section.gradeId}:${subject.id}`, {
        gradeId: section.gradeId,
        gradeCode: grade?.code ?? "?",
        subjectId: subject.id,
        subjectName: subject.name,
        sort: grade?.sort_key ?? 0,
      });
    }
  });
  return [...pairs.values()]
    .sort((a, b) => a.sort - b.sort || a.subjectName.localeCompare(b.subjectName))
    .map(({ gradeId, gradeCode, subjectId, subjectName }) => ({ gradeId, gradeCode, subjectId, subjectName }));
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
