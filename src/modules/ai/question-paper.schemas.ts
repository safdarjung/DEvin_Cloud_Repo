// features-18 §C #16 — /api/ai/question-paper. Blueprint rows are filled
// from the question bank first; only the leftover slots (at most
// QUESTION_PAPER_MAX_AI_SLOTS per request) go to the model, as drafts the
// teacher may save through the bank's own createQuestion action.
// Lesson 9: generated strings ≤500 chars.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { BasicQuestionTypeSchema, DifficultySchema, type Difficulty, type QuestionType } from "@/modules/question-bank/schemas";

export const QUESTION_PAPER_MAX_AI_SLOTS = 10;

const toHundredths = (n: number) => Math.round(n * 100);

export const BlueprintRowSchema = z
  .object({
    curriculumUnitId: uuid,
    difficulty: DifficultySchema,
    // Same bounds as question_bank.marks (QuestionCreateSchema).
    marks: z.number().positive().max(100).multipleOf(0.01),
    count: z.number().int().min(1).max(20),
  })
  .strict();
export type BlueprintRow = z.infer<typeof BlueprintRowSchema>;

export const QuestionPaperRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    gradeId: uuid,
    subjectId: uuid,
    totalMarks: z.number().positive().max(1000),
    rows: z.array(BlueprintRowSchema).min(1).max(10),
  })
  .strict()
  .refine((v) => v.rows.reduce((sum, r) => sum + toHundredths(r.marks) * r.count, 0) === toHundredths(v.totalMarks), {
    path: ["totalMarks"],
    message: "Blueprint rows must add up to the total marks.",
  });
export type QuestionPaperRequest = z.infer<typeof QuestionPaperRequestSchema>;

export const QuestionPaperGenerationSchema = z
  .object({
    questions: z
      .array(
        z
          .object({
            type: BasicQuestionTypeSchema,
            body: z.string().trim().min(1).max(500),
            options: z.array(z.string().trim().min(1).max(120)).max(6),
            answer: z.string().trim().min(1).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(QUESTION_PAPER_MAX_AI_SLOTS),
  })
  .strict();

/** A question picked from the bank (answer left out: the paper is the question sheet). */
export interface PaperQuestion {
  id: string;
  curriculumUnitId: string;
  difficulty: Difficulty;
  type: QuestionType;
  body: string;
  options: string[] | null;
  marks: number;
}

/** An AI-written question for an unfilled slot. Shaped like QuestionCreateInput so the teacher can save it. */
export interface DraftQuestion {
  subjectId: string;
  gradeId: string;
  curriculumUnitId: string;
  difficulty: Difficulty;
  marks: number;
  type: z.infer<typeof BasicQuestionTypeSchema>;
  body: string;
  options: string[];
  answer: string;
}

export interface QuestionPaperResponse {
  picked: PaperQuestion[];
  drafts: DraftQuestion[];
  /** Slots neither the bank nor the model filled. */
  unfilled: number;
  /** Why the model left slots unfilled, when it failed. */
  aiNote: string | null;
  provider: "local" | "cloud" | null;
  model: string | null;
}

export function sameMarks(a: number, b: number): boolean {
  return toHundredths(a) === toHundredths(b);
}
