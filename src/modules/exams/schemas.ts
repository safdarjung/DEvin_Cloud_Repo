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

// T-020 — recheck workflow (06 §W8). The window/one-open-request/reason
// checks are re-enforced in SQL (app.request_recheck, 20261028000022) since
// a guardian/student JWT can call that RPC directly over PostgREST — this
// schema is the first, not the only, line of validation (rule 4).
export const RequestRecheckSchema = z
  .object({
    resultId: uuid,
    examPaperId: uuid,
    reason: z.string().trim().min(10).max(1000),
  })
  .strict();

export type RequestRecheckInput = z.infer<typeof RequestRecheckSchema>;

export const RecheckIdSchema = z.object({ requestId: uuid }).strict();
export type RecheckIdInput = z.infer<typeof RecheckIdSchema>;

export const DecideRecheckSchema = z
  .object({
    requestId: uuid,
    decision: z.enum(["approve", "reject"]),
    newMarks: money.optional(),
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine((input) => input.decision !== "approve" || input.newMarks !== undefined, {
    message: "newMarks is required to approve a recheck.",
    path: ["newMarks"],
  });

export type DecideRecheckInput = z.infer<typeof DecideRecheckSchema>;

// T-0NN — result remarks (07 §2.2 exam.marks.enter). RLS (0047
// result_remarks_insert/_update) re-enforces the write scope; this schema
// is the first line of validation (rule 4).
export const SaveResultRemarkSchema = z
  .object({
    resultId: uuid,
    remark: z.string().trim().min(1).max(500),
  })
  .strict();

export type SaveResultRemarkInput = z.infer<typeof SaveResultRemarkSchema>;
