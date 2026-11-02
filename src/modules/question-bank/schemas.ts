// M11-T3 — Zod schemas for question bank operations. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const QuestionTypeSchema = z.enum([
  "mcq",
  "true_false",
  "short_answer",
  "long_answer",
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

const baseQuestionObject = z.object({
  subjectId: uuid,
  gradeId: uuid,
  curriculumUnitId: uuid.nullable().optional(),
  type: QuestionTypeSchema,
  difficulty: DifficultySchema,
  body: z.string().trim().min(1).max(4000),
  options: z.array(z.string().trim().min(1).max(500)).optional(),
  answer: z.string().trim().min(1).max(4000),
  marks: z.number().positive().max(100).multipleOf(0.01),
});

export const QuestionCreateSchema = baseQuestionObject
  .strict()
  .superRefine((data, ctx) => {
    // MCQ must have options (2-6), and answer must be in options
    if (data.type === "mcq") {
      if (!data.options || data.options.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "MCQ questions must have options",
        });
      } else if (data.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "MCQ questions must have at least 2 options",
        });
      } else if (data.options.length > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "MCQ questions can have at most 6 options",
        });
      }

      // Check for duplicate options
      if (data.options && new Set(data.options).size !== data.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "Duplicate options not allowed",
        });
      }

      // Check that answer is in options
      if (data.options && !data.options.includes(data.answer)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answer"],
          message: "Answer must be one of the provided options",
        });
      }
    } else {
      // Non-MCQ questions must not have options
      if (data.options && data.options.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "Only MCQ questions can have options",
        });
      }
    }

    // True/false questions must have answer as "true" or "false"
    if (data.type === "true_false") {
      if (data.answer !== "true" && data.answer !== "false") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answer"],
          message: 'True/false questions must have answer "true" or "false"',
        });
      }
    }
  });
export type QuestionCreateInput = z.infer<typeof QuestionCreateSchema>;

export const QuestionUpdateSchema = baseQuestionObject
  .extend({ id: uuid })
  .strict()
  .superRefine((data, ctx) => {
    // MCQ must have options (2-6), and answer must be in options
    if (data.type === "mcq") {
      if (!data.options || data.options.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "MCQ questions must have options",
        });
      } else if (data.options.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "MCQ questions must have at least 2 options",
        });
      } else if (data.options.length > 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "MCQ questions can have at most 6 options",
        });
      }

      // Check for duplicate options
      if (data.options && new Set(data.options).size !== data.options.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "Duplicate options not allowed",
        });
      }

      // Check that answer is in options
      if (data.options && !data.options.includes(data.answer)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answer"],
          message: "Answer must be one of the provided options",
        });
      }
    } else {
      // Non-MCQ questions must not have options
      if (data.options && data.options.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["options"],
          message: "Only MCQ questions can have options",
        });
      }
    }

    // True/false questions must have answer as "true" or "false"
    if (data.type === "true_false") {
      if (data.answer !== "true" && data.answer !== "false") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["answer"],
          message: 'True/false questions must have answer "true" or "false"',
        });
      }
    }
  });
export type QuestionUpdateInput = z.infer<typeof QuestionUpdateSchema>;

export const QuestionArchiveSchema = z
  .object({
    id: uuid,
    isActive: z.boolean(),
  })
  .strict();
export type QuestionArchiveInput = z.infer<typeof QuestionArchiveSchema>;

export const QuestionListSchema = z
  .object({
    subjectId: uuid.optional(),
    gradeId: uuid.optional(),
    curriculumUnitId: uuid.optional(),
    type: QuestionTypeSchema.optional(),
    difficulty: DifficultySchema.optional(),
    includeArchived: z.boolean().default(false),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type QuestionListInput = z.infer<typeof QuestionListSchema>;
