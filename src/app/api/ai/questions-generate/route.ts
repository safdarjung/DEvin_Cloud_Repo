import "server-only";
// 0148 / Phase 2 (15-learning-exam-system-plan.md) — question drafts grounded
// in the school's own extracted textbook text. Retrieval runs under the
// caller's RLS (content.search): unit/topic/outcome words, filtered to the
// grade+subject (and book/chapters when given), capped at 12k characters.
// No retrieved text -> "source content insufficient", and nothing is
// generated unless the caller sets allowUngrounded. Page references are kept
// only when they fall inside a retrieved chunk (grounding.ts). Saves nothing:
// each draft is a QuestionCreateInput (origin 'ai') the teacher may save with
// the bank's own createQuestion action, which stores it as a draft.
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { listCurriculumUnits } from "@/modules/academics/assignments.queries";
import { listTopics } from "@/modules/academics/curriculum.queries";
import { buildGroundedQuestionsPrompt, GROUNDED_QUESTIONS_INSTRUCTIONS } from "@/modules/ai/prompts/textbook-grounded";
import { aiTaskRoute } from "@/modules/ai/task-route";
import {
  buildSearchQuery,
  contextChars,
  INSUFFICIENT_SOURCE,
  MIN_CONTEXT_CHARS,
  QuestionsGenerateRequestSchema,
  QuestionsGenerationSchema,
  selectContext,
  sourceRefs,
  toDrafts,
  type LabelledChunk,
  type QuestionsGenerateRequest,
  type SourceRef,
} from "@/modules/content/grounding";
import { findChunks } from "@/modules/content/queries";
import { listTeachingPairs } from "@/modules/question-bank/queries";
import type { QuestionCreateInput } from "@/modules/question-bank/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RETRIEVE_LIMIT = 30;
// Lesson 9: always cap output (10 questions x ~1.2k chars of JSON at most).
const MAX_OUTPUT_TOKENS = 6144;

export interface QuestionsGenerateResponse {
  grounded: boolean;
  note: string | null;
  sources: SourceRef[];
  drafts: QuestionCreateInput[];
  dropped: number;
  provider: string | null;
  model: string | null;
}

async function retrieve(ctx: Parameters<typeof findChunks>[0], input: QuestionsGenerateRequest, terms: string[]): Promise<LabelledChunk[]> {
  const scope = { gradeId: input.gradeId, subjectId: input.subjectId, subjectTextbookId: input.subjectTextbookId, chapterNos: input.chapterNos, limit: RETRIEVE_LIMIT };
  const q = buildSearchQuery(terms);
  let rows = q ? await findChunks(ctx, { ...scope, q }) : [];
  // Chapters chosen but no word matched: the chapters' own text, in page order.
  if (rows.length === 0 && input.chapterNos?.length) rows = await findChunks(ctx, { ...scope, q: null });
  return selectContext(rows);
}

export const POST = aiTaskRoute<QuestionsGenerateRequest, QuestionsGenerateResponse>({
  route: "questions-generate",
  schema: QuestionsGenerateRequestSchema,
  maxBodyBytes: 16 * 1024,
  permission: "question.manage",
  capability: "question_paper_builder",
  run: async (ctx, input): Promise<ActionResult<QuestionsGenerateResponse>> => {
    const { gradeId, subjectId } = input;
    // Teacher scope: only (grade, subject) pairs they teach (leaders: all).
    const pair = (await listTeachingPairs(ctx)).find((p) => p.gradeId === gradeId && p.subjectId === subjectId);
    if (!pair) return fail("not_found", "Grade and subject not found among the ones you teach.");

    let unitTitle: string | null = null;
    if (input.curriculumUnitId) {
      const unit = (await listCurriculumUnits(ctx, { gradeId, subjectId })).find((u) => u.id === input.curriculumUnitId);
      if (!unit) return fail("not_found", "Curriculum unit not found for this grade and subject.");
      unitTitle = unit.title;
    }
    let topicTitles: string[] = [];
    if (input.topicIds?.length) {
      const topics = (await listTopics(ctx, { curriculumUnitId: input.curriculumUnitId, gradeId, subjectId })).filter((t) => input.topicIds?.includes(t.id));
      if (topics.length !== new Set(input.topicIds).size) return fail("not_found", "Topic not found for this grade, subject and unit.");
      topicTitles = topics.map((t) => t.title);
    }
    const learningOutcomes = input.learningOutcomes ?? [];

    const retrieved = await retrieve(ctx, input, [unitTitle ?? "", ...topicTitles, ...learningOutcomes]);
    const grounded = contextChars(retrieved) >= MIN_CONTEXT_CHARS;
    const chunks = grounded ? retrieved : [];
    const empty: QuestionsGenerateResponse = { grounded, note: grounded ? null : INSUFFICIENT_SOURCE, sources: sourceRefs(chunks), drafts: [], dropped: 0, provider: null, model: null };
    if (!grounded && !input.allowUngrounded) return ok(empty);

    const generated = await runStructured({
      ctx,
      feature: "question_generate_grounded",
      agentCloud: ctx.institution.ai_policy !== "local_only", // owner cloud exception (D28 ext.), never under local_only (rule 6): textbook text only, no student data; redacted on the cloud path
      schema: QuestionsGenerationSchema,
      instructions: GROUNDED_QUESTIONS_INSTRUCTIONS,
      prompt: buildGroundedQuestionsPrompt({
        subjectName: pair.subjectName,
        gradeLabel: pair.gradeCode,
        count: input.count,
        types: input.types,
        difficulty: input.difficulty,
        marksEach: input.marksEach,
        unitTitle,
        topicTitles,
        learningOutcomes,
        chunks,
      }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const { drafts, dropped } = toDrafts(
      generated.data.data.questions.slice(0, input.count),
      {
        gradeId,
        subjectId,
        curriculumUnitId: input.curriculumUnitId ?? null,
        curriculumTopicId: input.topicIds?.length === 1 ? input.topicIds[0] : null,
        difficulty: input.difficulty,
        marks: input.marksEach,
        aiModel: generated.data.model,
      },
      input.types,
      chunks,
    );
    return ok({ ...empty, drafts, dropped, provider: generated.data.provider, model: generated.data.model });
  },
});
