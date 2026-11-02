// M09-T3 — submission schemas (06 §1.3). All `.strict()` per CLAUDE.md rule 4.
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const SubmitAssignmentSchema = z
  .object({
    assignmentId: uuid,
    text: z.string().trim().min(1).max(5000).optional(),
    answers: z
      .array(z.string().trim().min(1).max(500))
      .max(30)
      .optional(),
  })
  .strict();

export type SubmitAssignmentInput = z.infer<typeof SubmitAssignmentSchema>;

export const GradeSubmissionSchema = z
  .object({
    submissionId: uuid,
    score: z.number().min(0),
    maxScore: z.number().min(0.01).max(1000),
    feedback: z.string().trim().max(2000).optional(),
  })
  .strict()
  .refine((data) => data.score <= data.maxScore, {
    message: "Score cannot exceed maxScore.",
    path: ["score"],
  });

export type GradeSubmissionInput = z.infer<typeof GradeSubmissionSchema>;

export const SubmissionsForAssignmentSchema = z
  .object({
    assignmentId: uuid,
  })
  .strict();

export type SubmissionsForAssignmentInput = z.infer<
  typeof SubmissionsForAssignmentSchema
>;

export const MySubmissionsSchema = z
  .object({
    studentId: uuid.optional(),
  })
  .strict();

export type MySubmissionsInput = z.infer<typeof MySubmissionsSchema>;
