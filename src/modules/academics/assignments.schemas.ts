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
