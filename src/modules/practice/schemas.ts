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

export const SubmitAttemptSchema = z
  .object({
    studentId: uuid,
    curriculumUnitId: uuid,
    difficulty: z.enum(PRACTICE_DIFFICULTIES),
    questions: z.array(PracticeQuestionSchema).min(1).max(PRACTICE_MAX_QUESTIONS),
    // Selected option index per question, null = skipped. No score field: the server computes it.
    answers: z.array(z.number().int().min(0).max(3).nullable()).min(1).max(PRACTICE_MAX_QUESTIONS),
  })
  .strict()
  .refine((d) => d.answers.length === d.questions.length, {
    message: "answers must have one entry per question",
    path: ["answers"],
  });
export type SubmitAttemptInput = z.infer<typeof SubmitAttemptSchema>;

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
