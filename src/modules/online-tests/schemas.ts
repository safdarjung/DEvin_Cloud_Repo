// Phase 4 (15-learning-exam-system-plan.md) — online test schemas. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

const text = (max: number) => z.string().trim().min(1).max(max);
const dateTime = z.string().datetime({ offset: true });

export const TestStatusSchema = z.enum(["draft", "scheduled", "open", "closed", "evaluating", "published", "cancelled"]);
export type TestStatus = z.infer<typeof TestStatusSchema>;

export const ReleasePolicySchema = z.enum(["never", "after_close", "after_publish"]);
export type ReleasePolicy = z.infer<typeof ReleasePolicySchema>;

export const AttemptStatusSchema = z.enum(["in_progress", "submitted", "auto_submitted", "evaluated"]);
export type AttemptStatus = z.infer<typeof AttemptStatusSchema>;

const settings = {
  title: text(200),
  sectionIds: z.array(uuid).min(1).max(50),
  opensAt: dateTime,
  closesAt: dateTime,
  durationMinutes: z.number().int().min(1).max(600),
  maxAttempts: z.number().int().min(1).max(10),
  shuffle: z.boolean(),
  showResults: ReleasePolicySchema,
  showAnswers: ReleasePolicySchema,
  practice: z.boolean(),
};

const windowOk = (t: { opensAt?: string; closesAt?: string }) => !t.opensAt || !t.closesAt || Date.parse(t.closesAt) > Date.parse(t.opensAt);
const windowIssue = { path: ["closesAt"], message: "Closing time must be after opening time" };
// Only practice may release results at close; an exam test waits for leadership to publish (0150 check too).
const releaseOk = (t: { practice?: boolean; showResults?: ReleasePolicy }) => t.practice !== false || t.showResults !== "after_close";
const releaseIssue = { path: ["showResults"], message: "Only a practice test can show results at closing time" };

export const TestCreateSchema = z
  .object({
    questionPaperId: uuid,
    /** Defaults to the paper's current (latest approved/published) version. */
    paperVersionNo: z.number().int().min(1).optional(),
    ...settings,
    maxAttempts: settings.maxAttempts.default(1),
    shuffle: settings.shuffle.default(false),
    showResults: settings.showResults.default("after_publish"),
    showAnswers: settings.showAnswers.default("after_publish"),
    practice: settings.practice.default(false),
  })
  .strict()
  .refine(windowOk, windowIssue)
  .refine(releaseOk, releaseIssue);
export type TestCreateInput = z.infer<typeof TestCreateSchema>;

export const TestUpdateSchema = z
  .object({ id: uuid, paperVersionNo: z.number().int().min(1).optional(), ...z.object(settings).partial().shape })
  .strict()
  .refine(windowOk, windowIssue)
  .refine(releaseOk, releaseIssue);
export type TestUpdateInput = z.infer<typeof TestUpdateSchema>;

export const TestIdSchema = z.object({ id: uuid }).strict();
export const TestListSchema = z.object({ status: TestStatusSchema.optional() }).strict();
export const TestIdRefSchema = z.object({ testId: uuid }).strict();
export const NoInputSchema = z.object({}).strict();

export const AttemptStartSchema = z
  .object({
    testId: uuid,
    // Minimal device hint for the audit trail; nothing identifying.
    clientInfo: z.object({ userAgent: z.string().max(300).optional(), tz: z.string().max(60).optional() }).strict().optional(),
  })
  .strict();

/** Answer shapes: text (mcq option, true/false, A-D, written answer), number, or a list (multi_select, fill_blank, match). */
export const AnswerSchema = z.union([
  z.string().max(8000),
  z.number().finite(),
  z.array(z.union([z.string().max(500), z.number().int().min(0).max(99)])).max(20),
]);
export type Answer = z.infer<typeof AnswerSchema>;

export const SaveResponseSchema = z
  .object({ attemptId: uuid, itemKey: uuid, answer: AnswerSchema.nullable(), flagged: z.boolean().default(false) })
  .strict();

export const AttemptIdSchema = z.object({ attemptId: uuid }).strict();
export const ResponseIdSchema = z.object({ responseId: uuid }).strict();

export const SaveMarksSchema = z
  .object({ responseId: uuid, marks: z.number().min(0).max(100).multipleOf(0.01), feedback: text(2000).nullable().optional() })
  .strict();
