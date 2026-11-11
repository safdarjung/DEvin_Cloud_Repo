import "server-only";
// features-18 §C #16 — question paper from a marks blueprint on
// /question-bank. Each blueprint row (unit, difficulty, marks, count) is
// filled first from the question bank, deterministically (active questions
// with exactly that unit, difficulty and marks, in id order, never reused).
// Only the unfilled slots go to the model, returned as drafts marked
// "AI draft — review before use"; the teacher may save one with the bank's
// own createQuestion action. Never auto-saves; never writes papers or marks.
import { fail, ok } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { listCurriculumUnits } from "@/modules/academics/assignments.queries";
import { buildQuestionPaperPrompt, QUESTION_PAPER_INSTRUCTIONS } from "@/modules/ai/prompts/question-paper";
import {
  QUESTION_PAPER_MAX_AI_SLOTS,
  QuestionPaperGenerationSchema,
  QuestionPaperRequestSchema,
  sameMarks,
  type BlueprintRow,
  type DraftQuestion,
  type PaperQuestion,
  type QuestionPaperRequest,
  type QuestionPaperResponse,
} from "@/modules/ai/question-paper.schemas";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { listQuestions, listTeachingPairs } from "@/modules/question-bank/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lesson 9: always cap output (10 questions x ~1.2k chars of JSON at most).
const MAX_OUTPUT_TOKENS = 4096;
// listQuestions' own page-size ceiling; one row rarely has more candidates.
const CANDIDATES_PER_ROW = 100;

export const POST = aiTaskRoute<QuestionPaperRequest, QuestionPaperResponse>({
  route: "question-paper",
  schema: QuestionPaperRequestSchema,
  maxBodyBytes: 8 * 1024,
  permission: "question.manage",
  capability: "question_paper_builder",
  run: async (ctx, input) => {
    const { gradeId, subjectId } = input;

    // Owner queries under the caller's RLS: a teacher gets only the (grade,
    // subject) pairs they teach; units come from that pair only.
    const pair = (await listTeachingPairs(ctx)).find((p) => p.gradeId === gradeId && p.subjectId === subjectId);
    if (!pair) return fail("not_found", "Grade and subject not found among the ones you teach.");
    const unitTitleById = new Map((await listCurriculumUnits(ctx, { gradeId, subjectId })).map((u) => [u.id, u.title]));
    if (input.rows.some((r) => !unitTitleById.has(r.curriculumUnitId))) {
      return fail("not_found", "Curriculum unit not found for this grade and subject.");
    }

    const picked: PaperQuestion[] = [];
    const slots: BlueprintRow[] = [];
    const used = new Set<string>();
    for (const row of input.rows) {
      const { items } = await listQuestions(ctx, {
        subjectId,
        gradeId,
        curriculumUnitId: row.curriculumUnitId,
        difficulty: row.difficulty,
        includeArchived: false,
        page: 1,
        pageSize: CANDIDATES_PER_ROW,
      });
      const matches = items
        .filter((q) => sameMarks(q.marks, row.marks) && !used.has(q.id))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, row.count);
      for (const q of matches) {
        used.add(q.id);
        picked.push({ id: q.id, curriculumUnitId: row.curriculumUnitId, difficulty: q.difficulty, type: q.type, body: q.body, options: q.options, marks: q.marks });
      }
      for (let i = matches.length; i < row.count; i++) slots.push(row);
    }

    const result: QuestionPaperResponse = { picked, drafts: [], unfilled: slots.length, aiNote: null, provider: null, model: null };
    if (slots.length === 0) return ok(result);

    const aiSlots = slots.slice(0, QUESTION_PAPER_MAX_AI_SLOTS);
    const generated = await runStructured({
      ctx,
      feature: "question_paper_draft",
      schema: QuestionPaperGenerationSchema,
      instructions: QUESTION_PAPER_INSTRUCTIONS,
      prompt: buildQuestionPaperPrompt({
        subjectName: pair.subjectName,
        gradeLabel: pair.gradeCode,
        slots: aiSlots.map((s) => ({ unitTitle: unitTitleById.get(s.curriculumUnitId) ?? "", difficulty: s.difficulty, marks: s.marks })),
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    // The bank picks stand on their own: a model failure only leaves the gaps unfilled.
    if (!generated.ok) return ok({ ...result, aiNote: generated.error.message });

    const drafts: DraftQuestion[] = generated.data.data.questions.slice(0, aiSlots.length).map((q, i) => ({
      subjectId,
      gradeId,
      curriculumUnitId: aiSlots[i].curriculumUnitId,
      difficulty: aiSlots[i].difficulty,
      marks: aiSlots[i].marks,
      type: q.type,
      body: q.body,
      options: q.type === "mcq" ? q.options : [],
      answer: q.answer,
    }));
    return ok({ ...result, drafts, unfilled: slots.length - drafts.length, provider: generated.data.provider, model: generated.data.model });
  },
});
