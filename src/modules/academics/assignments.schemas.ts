// T-022 — assignments module schemas (06 §W6, 05 §2.3). `.strict()` on every
// object per CLAUDE.md rule 4. QuizContentSchema must stay identical to what
// T-036 imports from here (packet assumption).
import { z } from "zod";
import { longText, shortText, uuid } from "@/lib/schemas/common";

const quizOptionText = z.string().trim().min(1).max(500);

const QuizQuestionSchema = z
  .object({
    stem: z.string().trim().min(1).max(2000),
    options: z
      .array(quizOptionText)
      .length(4)
      .refine((options) => new Set(options).size === options.length, {
        message: "Options must be unique.",
      }),
    answer: quizOptionText,
    explanation: longText.optional(),
  })
  .strict()
  .refine((q) => q.options.includes(q.answer), {
    message: "Answer must be one of the options.",
    path: ["answer"],
  });

export const QuizContentSchema = z
  .object({
    questions: z.array(QuizQuestionSchema).min(1).max(30),
  })
  .strict();

export type QuizContent = z.infer<typeof QuizContentSchema>;

/**
 * Removes `answer`/`explanation` from every question, server-side, before
 * the object ever reaches a component (CLAUDE.md: hiding UI is never
 * authorization — guardians/students must not receive the answer in the
 * payload even if the client only renders it conditionally). `answer` is
 * set to `""`, which matches none of the 4 options.
 */
export function redactQuizAnswers(content: QuizContent): QuizContent {
  return {
    questions: content.questions.map((question) => ({
      stem: question.stem,
      options: question.options,
      answer: "",
      explanation: undefined,
    })),
  };
}

// DBT-21 (security review) — `assignments.content` no longer stores
// `answer`/`explanation` at all (0023's `assignment_answer_keys` is the only
// place they live, staff-only RLS): a guardian/student JWT could otherwise
// read them directly over PostgREST regardless of what `redactQuizAnswers`
// strips at the app layer (rule 2 — hiding UI/data in the app layer is never
// authorization). `QuizStoredContentSchema` is what's actually persisted in
// `assignments.content`; `AnswerKeyContentSchema` is what's persisted in
// `assignment_answer_keys.answers`, aligned by array index to the stored
// questions. `splitQuizContent`/`mergeQuizContent` convert between the full
// `QuizContent` shape (action inputs, AI generation output, the UI's edit
// form) and this two-table storage shape.

const QuizStoredQuestionSchema = z
  .object({
    stem: z.string().trim().min(1).max(2000),
    options: z
      .array(quizOptionText)
      .length(4)
      .refine((options) => new Set(options).size === options.length, {
        message: "Options must be unique.",
      }),
  })
  .strict();

export const QuizStoredContentSchema = z
  .object({
    questions: z.array(QuizStoredQuestionSchema).min(1).max(30),
  })
  .strict();

export type QuizStoredContent = z.infer<typeof QuizStoredContentSchema>;

const AnswerKeyQuestionSchema = z
  .object({
    answer: quizOptionText,
    explanation: longText.optional(),
  })
  .strict();

export const AnswerKeyContentSchema = z
  .object({
    questions: z.array(AnswerKeyQuestionSchema).min(1).max(30),
  })
  .strict();

export type AnswerKeyContent = z.infer<typeof AnswerKeyContentSchema>;

export function splitQuizContent(content: QuizContent): { stored: QuizStoredContent; answers: AnswerKeyContent } {
  return {
    stored: { questions: content.questions.map((q) => ({ stem: q.stem, options: q.options })) },
    answers: { questions: content.questions.map((q) => ({ answer: q.answer, explanation: q.explanation })) },
  };
}

/** `answers === null` (no row, or caller never fetched one — RLS already denies it to anyone without `assignment.manage`) yields the exact `redactQuizAnswers` shape: `answer: ""`, `explanation: undefined`. */
export function mergeQuizContent(stored: QuizStoredContent, answers: AnswerKeyContent | null): QuizContent {
  return {
    questions: stored.questions.map((q, index) => ({
      stem: q.stem,
      options: q.options,
      answer: answers?.questions[index]?.answer ?? "",
      explanation: answers?.questions[index]?.explanation,
    })),
  };
}

export const CreateAssignmentSchema = z
  .object({
    classSectionId: uuid,
    subjectId: uuid,
    curriculumUnitId: uuid.optional(),
    title: shortText,
    instructions: longText.optional(),
    dueAt: z.string().datetime().optional(),
    content: QuizContentSchema.optional(),
    aiGenerated: z.boolean().optional(),
    /** 0140: the teacher's own study-studio material this homework is about (RLS binds it). */
    studyMaterialId: uuid.optional(),
  })
  .strict();

export type CreateAssignmentInput = z.infer<typeof CreateAssignmentSchema>;

// classSectionId/subjectId are immutable after creation (ponytail: moving an
// assignment to a different section/subject is out of scope — not asked for
// by the packet's acceptance criteria).
export const UpdateAssignmentSchema = z
  .object({
    assignmentId: uuid,
    curriculumUnitId: uuid.optional(),
    title: shortText.optional(),
    instructions: longText.optional(),
    dueAt: z.string().datetime().optional(),
    content: QuizContentSchema.optional(),
    aiGenerated: z.boolean().optional(),
  })
  .strict();

export type UpdateAssignmentInput = z.infer<typeof UpdateAssignmentSchema>;

export const PublishAssignmentSchema = z.object({ assignmentId: uuid }).strict();

export type PublishAssignmentInput = z.infer<typeof PublishAssignmentSchema>;
