// T-018 — exams module schemas (06 §W7, 05 §2.7 exam rows). `.strict()` on
// every object per CLAUDE.md rule 4. `type` matches the exams table's check
// constraint exactly (fixed by the DB, not by per-institution settings, so
// no runtime-settings lookup is needed here).
import { z } from "zod";
import { isoDate, money, shortText, uuid } from "@/lib/schemas/common";

export const ExamIdSchema = z.object({ examId: uuid }).strict();
export type ExamIdInput = z.infer<typeof ExamIdSchema>;

export const CreateExamSchema = z
  .object({
    termId: uuid,
    name: shortText,
    type: z.enum(["unit_test", "half_yearly", "annual"]),
    gradingScaleKey: z.string().trim().min(1).max(100).default("default"),
  })
  .strict();

export type CreateExamInput = z.infer<typeof CreateExamSchema>;

const ExamPaperInputSchema = z
  .object({
    classSectionId: uuid,
    subjectId: uuid,
    maxMarks: money.positive(),
    passMarks: money,
    heldOn: isoDate.optional(),
  })
  .strict()
  .refine((p) => p.passMarks <= p.maxMarks, {
    message: "Pass marks cannot exceed max marks.",
    path: ["passMarks"],
  });

export const CreateExamPapersSchema = z
  .object({
    examId: uuid,
    papers: z.array(ExamPaperInputSchema).min(1).max(200),
  })
  .strict();

export type CreateExamPapersInput = z.infer<typeof CreateExamPapersSchema>;

const MarksRowSchema = z
  .object({
    studentId: uuid,
    marksObtained: money.optional(),
    isAbsent: z.boolean(),
  })
  .strict()
  .refine((r) => r.isAbsent !== (r.marksObtained !== undefined), {
    message: "Exactly one of isAbsent or marksObtained must be set.",
    path: ["marksObtained"],
  });

export const EnterMarksSchema = z
  .object({
    examPaperId: uuid,
    marks: z.array(MarksRowSchema).min(1).max(60),
  })
  .strict()
  .refine((input) => new Set(input.marks.map((m) => m.studentId)).size === input.marks.length, {
    message: "Duplicate studentId in marks.",
    path: ["marks"],
  });

export type EnterMarksInput = z.infer<typeof EnterMarksSchema>;
