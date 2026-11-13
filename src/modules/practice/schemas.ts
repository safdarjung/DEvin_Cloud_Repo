// Practice quiz schemas (migration 0103). Every object is .strict().
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { QuizGenerationQuestionSchema } from "@/modules/ai/quiz.schemas";

export const PRACTICE_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export const PRACTICE_MAX_QUESTIONS = 15;

const optionText = z.string().trim().min(1).max(500);

/** A generated question carrying its answer key (the correct option index). */
export const PracticeQuestionSchema = z
  .object({
    stem: z.string().trim().min(1).max(2000),
    options: z.array(optionText).length(4),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().max(2000).optional(),
  })
  .strict();
export type PracticeQuestion = z.infer<typeof PracticeQuestionSchema>;

// Answer shape per item type, as app.mark_test_item (0150) reads it: option
// text (mcq, true_false, assertion_reason), array (multi_select, fill_blank,
// match), number or text (numerical); null = skipped. Keys stay on the server.
const PracticeAnswerSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.array(z.union([z.string().max(200), z.number().finite()])).max(10),
  z.null(),
]);

export const SubmitSessionSchema = z
  .object({
    sessionId: uuid,
    answers: z.array(PracticeAnswerSchema).min(1).max(PRACTICE_MAX_QUESTIONS),
  })
  .strict();
export type SubmitSessionInput = z.infer<typeof SubmitSessionSchema>;

export const StartBankPracticeSchema = z
  .object({
    curriculumUnitId: uuid,
    topicId: uuid.optional(),
    // Omitted = a mix of difficulties.
    difficulty: z.enum(PRACTICE_DIFFICULTIES).optional(),
    count: z.number().int().min(1).max(PRACTICE_MAX_QUESTIONS).default(10),
  })
  .strict();
export type StartBankPracticeInput = z.infer<typeof StartBankPracticeSchema>;

/** A question as the student sees it: never the answer, key or explanation. */
export interface PracticeItem {
  key: string;
  type: string;
  body: string;
  options: unknown;
  marks: number;
}

export interface PracticeSession {
  sessionId: string;
  questions: PracticeItem[];
  /** Bank only: true when an open set for the same chapter, topic and difficulty was returned instead of a new one. */
  resumed?: boolean;
}

/** Per-question outcome, returned only after submit. */
export interface PracticeItemResult {
  key: string;
  type: string;
  unit: string | null;
  topic: string | null;
  marks: number;
  awarded: number;
  correct: boolean;
  given: unknown;
  answer: string | null;
  answerKey: unknown;
  explanation: string | null;
}

export interface PracticeSubmitResult {
  attemptId: string;
  score: number;
  maxScore: number;
  results: PracticeItemResult[];
}

export const PracticeQuizRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    unitId: uuid,
    difficulty: z.enum(PRACTICE_DIFFICULTIES),
    count: z.number().int().min(1).max(PRACTICE_MAX_QUESTIONS),
  })
  .strict();
export type PracticeQuizRequest = z.infer<typeof PracticeQuizRequestSchema>;

/** What the model must produce for a practice quiz: the teacher quiz question shape with a REQUIRED explanation. */
export const PracticeGenerationSchema = z
  .object({
    questions: z
      .array(QuizGenerationQuestionSchema.required({ explanation: true }))
      .min(1)
      .max(PRACTICE_MAX_QUESTIONS),
  })
  .strict();
