// M11-T3 — Zod schemas for question bank operations. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const QuestionTypeSchema = z.enum([
  "mcq",
  "true_false",
  "short_answer",
  "long_answer",
  "multi_select",
  "fill_blank",
  "match",
  "very_short_answer",
  "case_based",
  "assertion_reason",
  "numerical",
  "passage",
  "diagram",
]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

/** The four types the AI paper builder generates (its JSON schema stays small). */
export const BasicQuestionTypeSchema = z.enum(["mcq", "true_false", "short_answer", "long_answer"]);

export const DifficultySchema = z.enum(["easy", "medium", "hard"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const QuestionStatusSchema = z.enum(["draft", "in_review", "approved", "rejected", "archived"]);
export type QuestionStatus = z.infer<typeof QuestionStatusSchema>;

export const QuestionOriginSchema = z.enum(["manual", "ai", "import"]);
export type QuestionOrigin = z.infer<typeof QuestionOriginSchema>;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionText = text(500);
const answerText = text(4000);

// Fields every type shares. Per-type `options` / `answer` / `answerKey`
// below; SQL (0146) re-checks the cheap parts of each shape.
const common = {
  subjectId: uuid,
  gradeId: uuid,
  curriculumUnitId: uuid.nullable().optional(),
  curriculumTopicId: uuid.nullable().optional(),
  difficulty: DifficultySchema,
  body: text(4000),
  marks: z.number().positive().max(100).multipleOf(0.01),
  explanation: text(4000).nullable().optional(),
  markingScheme: text(4000).nullable().optional(),
  learningOutcome: text(300).nullable().optional(),
  sourceSubjectTextbookId: uuid.nullable().optional(),
  sourceChapterNo: z.number().int().min(1).max(99).nullable().optional(),
  sourcePage: z.number().int().min(1).max(2000).nullable().optional(),
  stemQuestionId: uuid.nullable().optional(),
};

const MatchOptionsSchema = z
  .object({ left: z.array(optionText).min(2).max(10), right: z.array(optionText).min(2).max(10) })
  .strict();
const AssertionReasonOptionsSchema = z.object({ assertion: text(1000), reason: text(1000) }).strict();
const NumericalKeySchema = z
  .object({ value: z.number().finite(), tolerance: z.number().min(0).default(0), unit: text(20).optional() })
  .strict();

// One strict object per type; `extra` adds create-only or update-only keys.
function variants<E extends z.ZodRawShape>(extra: E) {
  const base = { ...common, ...extra };
  const textAnswer = <T extends "short_answer" | "long_answer" | "very_short_answer" | "diagram">(type: T) =>
    z.object({ ...base, type: z.literal(type), answer: answerText }).strict();
  // A passage / case stem may carry no answer of its own (its sub-questions do).
  const stem = <T extends "passage" | "case_based">(type: T) =>
    z.object({ ...base, type: z.literal(type), answer: answerText.optional() }).strict();
  return [
    z.object({ ...base, type: z.literal("mcq"), options: z.array(optionText).min(2).max(6), answer: answerText }).strict(),
    z.object({ ...base, type: z.literal("true_false"), answer: z.enum(["true", "false"]) }).strict(),
    textAnswer("short_answer"),
    textAnswer("long_answer"),
    textAnswer("very_short_answer"),
    textAnswer("diagram"),
    stem("passage"),
    stem("case_based"),
    z
      .object({
        ...base,
        type: z.literal("multi_select"),
        options: z.array(optionText).min(2).max(8),
        answerKey: z.array(optionText).min(1).max(8),
        answer: answerText.optional(),
      })
      .strict(),
    z
      .object({ ...base, type: z.literal("fill_blank"), answerKey: z.array(text(200)).min(1).max(10), answer: answerText.optional() })
      .strict(),
    z
      .object({
        ...base,
        type: z.literal("match"),
        options: MatchOptionsSchema,
        // answerKey[i] = index into options.right matched to options.left[i]
        answerKey: z.array(z.number().int().min(0).max(9)).min(2).max(10),
        answer: answerText.optional(),
      })
      .strict(),
    z.object({ ...base, type: z.literal("numerical"), answerKey: NumericalKeySchema, answer: answerText.optional() }).strict(),
    z
      .object({ ...base, type: z.literal("assertion_reason"), options: AssertionReasonOptionsSchema, answer: z.enum(["A", "B", "C", "D"]) })
      .strict(),
  ] as const;
}

export type QuestionShape = z.infer<ReturnType<typeof variants<Record<never, never>>>[number]>;

const BLANK = /_{3,}/g;

// Cross-field rules the per-type shapes cannot express. Shared by create and
// update so the two schemas never diverge (M11 security review fix round 1).
function questionRules(data: QuestionShape, ctx: z.RefinementCtx): void {
  const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (data.type === "mcq" || data.type === "multi_select") {
    if (new Set(data.options).size !== data.options.length) issue("options", "Duplicate options not allowed");
  }
  if (data.type === "mcq" && !data.options.includes(data.answer)) issue("answer", "Answer must be one of the provided options");
  if (data.type === "multi_select") {
    if (data.answerKey.some((a) => !data.options.includes(a))) issue("answerKey", "Every correct answer must be one of the options");
    if (new Set(data.answerKey).size !== data.answerKey.length) issue("answerKey", "Duplicate correct answers");
  }
  if (data.type === "fill_blank" && (data.body.match(BLANK)?.length ?? 0) !== data.answerKey.length) {
    issue("answerKey", "Give one answer per blank (___) in the question");
  }
  if (data.type === "match") {
    if (data.answerKey.length !== data.options.left.length) issue("answerKey", "Match every left item once");
    if (data.answerKey.some((i) => i >= data.options.right.length)) issue("answerKey", "Match points past the right column");
  }
}

export const QuestionCreateSchema = z
  .discriminatedUnion("type", variants({ origin: QuestionOriginSchema.default("manual"), aiModel: text(120).nullable().optional() }))
  .superRefine(questionRules);
export type QuestionCreateInput = z.infer<typeof QuestionCreateSchema>;

export const QuestionUpdateSchema = z.discriminatedUnion("type", variants({ id: uuid })).superRefine(questionRules);
export type QuestionUpdateInput = z.infer<typeof QuestionUpdateSchema>;

/** The readable `answer` for types whose truth lives in `answerKey`. */
export function readableAnswer(q: QuestionShape): string {
  if (q.answer) return q.answer;
  switch (q.type) {
    case "multi_select":
    case "fill_blank":
      return q.answerKey.join("; ");
    case "match":
      return q.options.left.map((l, i) => `${l} - ${q.options.right[q.answerKey[i]]}`).join("; ");
    case "numerical": {
      const { value, tolerance, unit } = q.answerKey;
      return `${value}${tolerance ? ` (± ${tolerance})` : ""}${unit ? ` ${unit}` : ""}`;
    }
    default:
      return "See the sub-questions.";
  }
}

/** DB columns for the type-specific parts (`options`, `answer_key`, `answer`). */
export function questionShapeColumns(q: QuestionShape): { options: unknown; answer_key: unknown; answer: string } {
  return {
    options: "options" in q ? q.options : null,
    answer_key: "answerKey" in q ? q.answerKey : null,
    answer: readableAnswer(q),
  };
}

// CSV import (csv.actions.ts): `|` separates list cells.
const list = (v: string | undefined) => (v ? v.split("|").map((s) => s.trim()).filter(Boolean) : undefined);
const optional = (v: string | undefined) => (v ? v : undefined);

/** One CSV row -> the createQuestion input shape (validated by the caller). */
export function csvRowToQuestionInput(row: Record<string, string>, gradeId: string, subjectId: string, unitId: string | undefined): unknown {
  const type = row.type?.toLowerCase();
  const base = {
    subjectId,
    gradeId,
    curriculumUnitId: unitId,
    type,
    difficulty: row.difficulty?.toLowerCase(),
    body: row.body,
    marks: row.marks ? Number(row.marks) : undefined,
    explanation: optional(row.explanation),
    markingScheme: optional(row.marking_scheme),
    learningOutcome: optional(row.learning_outcome),
    origin: "import",
  };
  switch (type) {
    case "mcq":
      return { ...base, options: list(row.options), answer: row.answer };
    case "multi_select":
      return { ...base, options: list(row.options), answerKey: list(row.answer) };
    case "fill_blank":
      return { ...base, answerKey: list(row.answer) };
    case "numerical":
      return { ...base, answerKey: { value: Number(row.answer), tolerance: row.tolerance ? Number(row.tolerance) : 0 } };
    case "true_false":
      return { ...base, answer: row.answer?.toLowerCase() };
    default:
      return { ...base, answer: row.answer };
  }
}

export const QuestionArchiveSchema = z
  .object({
    id: uuid,
    isActive: z.boolean(),
  })
  .strict();
export type QuestionArchiveInput = z.infer<typeof QuestionArchiveSchema>;

export const QuestionIdSchema = z.object({ id: uuid }).strict();
export type QuestionIdInput = z.infer<typeof QuestionIdSchema>;

export const QuestionApproveSchema = z.object({ id: uuid, note: text(1000).optional() }).strict();
export type QuestionApproveInput = z.infer<typeof QuestionApproveSchema>;

export const QuestionRejectSchema = z.object({ id: uuid, note: text(1000) }).strict();
export type QuestionRejectInput = z.infer<typeof QuestionRejectSchema>;

export const QuestionImportSchema = z
  .object({ gradeId: uuid, subjectId: uuid, csv: z.string().min(1).max(1_048_576) })
  .strict();
export type QuestionImportInput = z.infer<typeof QuestionImportSchema>;

export const QuestionExportSchema = z
  .object({
    gradeId: uuid.optional(),
    subjectId: uuid.optional(),
    curriculumUnitId: uuid.optional(),
    status: QuestionStatusSchema.default("approved"),
  })
  .strict();
export type QuestionExportInput = z.infer<typeof QuestionExportSchema>;

export const CollectionCreateSchema = z
  .object({ name: text(120), description: text(1000).nullable().optional(), visibility: z.enum(["private", "school"]).default("private") })
  .strict();
export type CollectionCreateInput = z.infer<typeof CollectionCreateSchema>;

export const CollectionUpdateSchema = z
  .object({
    id: uuid,
    name: text(120).optional(),
    description: text(1000).nullable().optional(),
    visibility: z.enum(["private", "school"]).optional(),
  })
  .strict();
export type CollectionUpdateInput = z.infer<typeof CollectionUpdateSchema>;

export const CollectionItemsSchema = z.object({ collectionId: uuid, questionIds: z.array(uuid).min(1).max(200) }).strict();
export type CollectionItemsInput = z.infer<typeof CollectionItemsSchema>;

export const CollectionListSchema = z.object({}).strict();
export type CollectionListInput = z.infer<typeof CollectionListSchema>;

export const CollectionItemsListSchema = z.object({ collectionId: uuid }).strict();
export type CollectionItemsListInput = z.infer<typeof CollectionItemsListSchema>;

export const QuestionListSchema = z
  .object({
    subjectId: uuid.optional(),
    gradeId: uuid.optional(),
    curriculumUnitId: uuid.optional(),
    curriculumTopicId: uuid.optional(),
    type: QuestionTypeSchema.optional(),
    difficulty: DifficultySchema.optional(),
    status: QuestionStatusSchema.optional(),
    origin: QuestionOriginSchema.optional(),
    // Ignored when `status` is given; otherwise false hides archived rows.
    includeArchived: z.boolean().default(false),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type QuestionListInput = z.infer<typeof QuestionListSchema>;

// AI roles P4 — questionBank.paperDraft. Proportions (0..1) per difficulty
// of `totalMarks`; omitted difficulties get no quota. Not required to sum
// to 1 — leftover marks simply go unfilled if the bank runs short.
export const DifficultyMixSchema = z
  .object({
    easy: z.number().min(0).max(1).optional(),
    medium: z.number().min(0).max(1).optional(),
    hard: z.number().min(0).max(1).optional(),
  })
  .strict();
export type DifficultyMix = z.infer<typeof DifficultyMixSchema>;

export const PaperDraftSchema = z
  .object({
    unitIds: z.array(uuid).min(1).max(20),
    totalMarks: z.number().positive().max(1000),
    difficultyMix: DifficultyMixSchema.optional(),
  })
  .strict();
export type PaperDraftInput = z.infer<typeof PaperDraftSchema>;
