// 0148 / Phase 2 — grounded AI over extracted textbook text: request and
// model-output schemas, retrieval context, and the checks that keep page
// references honest. Pure (unit-tested in tests/unit/content-grounding.test.ts).
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { DifficultySchema, QuestionCreateSchema, type QuestionCreateInput } from "@/modules/question-bank/schemas";
import type { RetrievedChunk } from "./queries";
import { chapterNo } from "./schemas";

export const MAX_CONTEXT_CHARS = 12_000;
/** Less retrieved text than this is not enough to ground anything. */
export const MIN_CONTEXT_CHARS = 200;
export const MAX_GROUNDED_QUESTIONS = 10;
export const INSUFFICIENT_SOURCE =
  "Source content insufficient: no extracted textbook text matches this request. Read the book's PDF first, pick another chapter or unit, or allow ungrounded drafts.";

/** Types the generator can fill reliably from a flat JSON shape (no match/numerical/stems/diagrams). */
export const GROUNDED_TYPES = ["mcq", "true_false", "very_short_answer", "short_answer", "long_answer", "fill_blank", "multi_select", "assertion_reason"] as const;
export type GroundedType = (typeof GROUNDED_TYPES)[number];

const slug = z.string().trim().min(1).max(100);

export const QuestionsGenerateRequestSchema = z
  .object({
    institutionSlug: slug,
    gradeId: uuid,
    subjectId: uuid,
    subjectTextbookId: uuid.optional(),
    chapterNos: z.array(chapterNo).min(1).max(20).optional(),
    curriculumUnitId: uuid.optional(),
    topicIds: z.array(uuid).min(1).max(20).optional(),
    types: z.array(z.enum(GROUNDED_TYPES)).min(1).max(GROUNDED_TYPES.length),
    count: z.number().int().min(1).max(MAX_GROUNDED_QUESTIONS),
    marksEach: z.number().positive().max(100).multipleOf(0.01),
    difficulty: DifficultySchema,
    learningOutcomes: z.array(z.string().trim().min(1).max(300)).max(10).optional(),
    allowUngrounded: z.boolean().default(false),
  })
  .strict();
export type QuestionsGenerateRequest = z.infer<typeof QuestionsGenerateRequestSchema>;

const str = (max: number) => z.string().max(max);

export const GeneratedQuestionSchema = z.object({
  type: z.enum(GROUNDED_TYPES),
  body: z.string().trim().min(1).max(1000),
  options: z.array(str(300)).max(8),
  answer: str(1500),
  answerKey: z.array(str(200)).max(10),
  explanation: str(1000),
  learningOutcome: str(300),
  sourceChunk: str(10),
  sourcePage: z.number().int().min(0).max(2000),
});
export type GeneratedQuestion = z.infer<typeof GeneratedQuestionSchema>;

export const QuestionsGenerationSchema = z.object({ questions: z.array(GeneratedQuestionSchema).max(MAX_GROUNDED_QUESTIONS) });

export const ChapterSummaryRequestSchema = z.object({ institutionSlug: slug, subjectTextbookId: uuid, chapterNo }).strict();
export type ChapterSummaryRequest = z.infer<typeof ChapterSummaryRequestSchema>;

export const ChapterSummaryGenerationSchema = z.object({
  summary: z.string().trim().min(1).max(3000),
  keyPoints: z.array(z.object({ point: z.string().trim().min(1).max(300), page: z.number().int().min(0).max(2000) })).max(12),
});

export interface LabelledChunk extends RetrievedChunk {
  label: string;
}

export interface SourceRef {
  label: string;
  chunkId: string;
  subjectTextbookId: string;
  bookTitle: string | null;
  chapterNo: number | null;
  pageFrom: number;
  pageTo: number;
}

/** Retrieved chunks in rank order, labelled C1..Cn, until the character cap. */
export function selectContext(rows: readonly RetrievedChunk[], maxChars = MAX_CONTEXT_CHARS): LabelledChunk[] {
  const out: LabelledChunk[] = [];
  let used = 0;
  for (const row of rows) {
    if (used + row.body.length > maxChars) break;
    used += row.body.length;
    out.push({ ...row, label: `C${out.length + 1}` });
  }
  return out;
}

export function contextChars(chunks: readonly { body: string }[]): number {
  return chunks.reduce((n, c) => n + c.body.length, 0);
}

export function sourceRefs(chunks: readonly LabelledChunk[]): SourceRef[] {
  return chunks.map(({ label, chunkId, subjectTextbookId, bookTitle, chapterNo: ch, pageFrom, pageTo }) => ({ label, chunkId, subjectTextbookId, bookTitle, chapterNo: ch, pageFrom, pageTo }));
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "from", "into", "its", "are", "was", "how", "what", "why", "our", "their", "this", "that", "of", "in", "on", "to", "a", "an"]);

/** websearch_to_tsquery text: any significant word of the unit/topic/outcome titles (OR). Null when none. */
export function buildSearchQuery(terms: readonly string[]): string | null {
  const words = [
    ...new Set(
      terms
        .join(" ")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
    ),
  ].slice(0, 30);
  return words.length ? words.join(" or ") : null;
}

/**
 * Source fields for a draft. The book and chapter come from a retrieved
 * chunk the model named; the page only when it lies inside that chunk.
 * Anything else is dropped: a page reference is never invented.
 */
export function resolveSource(q: Pick<GeneratedQuestion, "sourceChunk" | "sourcePage">, chunks: readonly LabelledChunk[]): Pick<QuestionCreateInput, "sourceSubjectTextbookId" | "sourceChapterNo" | "sourcePage"> {
  const chunk = chunks.find((c) => c.label === q.sourceChunk.trim().replace(/^\[|\]$/g, ""));
  if (!chunk) return { sourceSubjectTextbookId: null, sourceChapterNo: null, sourcePage: null };
  const pageInChunk = q.sourcePage >= chunk.pageFrom && q.sourcePage <= chunk.pageTo;
  return { sourceSubjectTextbookId: chunk.subjectTextbookId, sourceChapterNo: chunk.chapterNo, sourcePage: pageInChunk ? q.sourcePage : null };
}

/** True when a cited page lies inside one of the retrieved chunks. */
export function pageIsRetrieved(page: number, chunks: readonly { pageFrom: number; pageTo: number }[]): boolean {
  return chunks.some((c) => page >= c.pageFrom && page <= c.pageTo);
}

export interface DraftBase {
  gradeId: string;
  subjectId: string;
  curriculumUnitId: string | null;
  curriculumTopicId: string | null;
  difficulty: QuestionCreateInput["difficulty"];
  marks: number;
  aiModel: string;
}

const blankToNull = (s: string) => (s.trim() ? s.trim() : null);

function typeFields(q: GeneratedQuestion): Record<string, unknown> {
  const answer = q.answer.trim();
  switch (q.type) {
    case "mcq":
      return { options: q.options.map((o) => o.trim()), answer };
    case "true_false":
      return { answer: answer.toLowerCase() };
    case "multi_select":
      return { options: q.options.map((o) => o.trim()), answerKey: q.answerKey.map((a) => a.trim()), answer: answer || undefined };
    case "fill_blank":
      return { answerKey: q.answerKey.map((a) => a.trim()), answer: answer || undefined };
    case "assertion_reason":
      return { options: { assertion: (q.options[0] ?? "").trim(), reason: (q.options[1] ?? "").trim() }, answer: answer.toUpperCase() };
    default:
      return { answer };
  }
}

/**
 * Model output -> bank drafts (origin 'ai', status set to draft by
 * createQuestion). Each draft must pass the bank's own QuestionCreateSchema;
 * anything else, or a type that was not asked for, is dropped and counted.
 */
export function toDrafts(
  questions: readonly GeneratedQuestion[],
  base: DraftBase,
  allowedTypes: readonly GroundedType[],
  chunks: readonly LabelledChunk[],
): { drafts: QuestionCreateInput[]; dropped: number } {
  const drafts: QuestionCreateInput[] = [];
  let dropped = 0;
  for (const q of questions) {
    if (!allowedTypes.includes(q.type)) {
      dropped += 1;
      continue;
    }
    const parsed = QuestionCreateSchema.safeParse({
      type: q.type,
      subjectId: base.subjectId,
      gradeId: base.gradeId,
      curriculumUnitId: base.curriculumUnitId,
      curriculumTopicId: base.curriculumTopicId,
      difficulty: base.difficulty,
      marks: base.marks,
      body: q.body.trim(),
      explanation: blankToNull(q.explanation),
      learningOutcome: blankToNull(q.learningOutcome),
      ...resolveSource(q, chunks),
      ...typeFields(q),
      origin: "ai",
      aiModel: base.aiModel.slice(0, 120),
    });
    if (parsed.success) drafts.push(parsed.data);
    else dropped += 1;
  }
  return { drafts, dropped };
}
