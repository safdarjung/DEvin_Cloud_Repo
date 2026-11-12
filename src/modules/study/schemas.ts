// Study studio request and action schemas. Every object is .strict().
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { DIFFICULTIES, QUIZ_LENGTHS, QUIZ_TYPES, QuizQuestionSchema, STUDY_FORMATS, contentSchema, type MaterialFormat } from "@/modules/study/formats";
import { MOCK_DURATIONS, MOCK_LENGTHS, MOCK_MAX_UNITS, MockContentSchema } from "@/modules/study/mock";
import { VARIANT_LANGUAGES } from "@/modules/study/variants";
import { WORKSHEET_LEVELS, WorksheetContentSchema } from "@/modules/study/worksheet";
import { StudyScopeSchema } from "@/modules/study/scope";
import { UIMessageRequestSchema } from "@/lib/ai/ui-message-schema";
import { REVIEW_GRADES } from "@/modules/study/srs";
import { SHORT_ANSWER_MAX } from "@/modules/study/quiz";

const institutionSlug = z.string().trim().min(1).max(100);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Pasted notes cap (characters). The text is untrusted: it goes only inside the prompt's data block. */
export const PASTE_MAX_CHARS = 12_000;
export const PASTE_MIN_CHARS = 40;

const unitSource = z.object({ kind: z.literal("unit"), unitId: uuid }).strict();
const pasteSource = z.object({ kind: z.literal("paste"), text: z.string().trim().min(PASTE_MIN_CHARS).max(PASTE_MAX_CHARS), subjectId: uuid.optional() }).strict();
const resourceSource = z.object({ kind: z.literal("resource"), resourceId: uuid }).strict();
const lessonPlanSource = z.object({ kind: z.literal("lesson_plan"), lessonPlanId: uuid }).strict();
// 0139: a unit's linked textbook chapter (book + chapter reference only; the AI never reads the PDF) plus optional pasted text.
const textbookSource = z.object({ kind: z.literal("textbook"), unitId: uuid, text: z.string().trim().max(PASTE_MAX_CHARS).optional() }).strict();
// 0140: a curriculum_materials upload the caller may read (re-checked server-side; bytes fetched under their RLS).
const fileSource = z.object({ kind: z.literal("file"), materialId: uuid }).strict();
// 0140: the student's own weakest units (revision pack), chosen server-side.
const weakUnitsSource = z.object({ kind: z.literal("weak_units") }).strict();
// 0140: a taught section's weakest units (class revision pack), aggregate only.
const classWeakUnitsSource = z.object({ kind: z.literal("class_weak_units"), sectionId: uuid }).strict();
// 0140 item 8: a student's saved "study with AI" scope (study_items id), rebuilt server-side.
const scopeSource = z.object({ kind: z.literal("scope"), itemId: uuid }).strict();
// 0140 item 8 (teacher): chosen units of subjects the teacher teaches.
const unitsSource = z.object({ kind: z.literal("units"), unitIds: z.array(uuid).min(1).max(12) }).strict();

export const StudentSourceSchema = z.discriminatedUnion("kind", [unitSource, pasteSource, resourceSource, textbookSource, fileSource, weakUnitsSource, scopeSource]);
export const TeacherSourceSchema = z.discriminatedUnion("kind", [unitSource, pasteSource, resourceSource, lessonPlanSource, textbookSource, fileSource, classWeakUnitsSource, unitsSource]);
export type StudySource = z.infer<typeof TeacherSourceSchema> | z.infer<typeof StudentSourceSchema>;

const QuizRequestSchema = z
  .object({
    count: z.union([z.literal(QUIZ_LENGTHS[0]), z.literal(QUIZ_LENGTHS[1]), z.literal(QUIZ_LENGTHS[2])]),
    difficulty: z.enum(DIFFICULTIES),
    types: z.array(z.enum(QUIZ_TYPES)).min(1).max(3),
    /** What the student or teacher wants the questions to concentrate on (a topic they typed). */
    focus: z.string().trim().max(200).optional(),
  })
  .strict();

const generateBase = { institutionSlug, quiz: QuizRequestSchema.optional() };
export const StudyGenerateRequestSchema = z.object({ ...generateBase, format: z.enum(STUDY_FORMATS), source: StudentSourceSchema }).strict();
// Teachers may also draft a three-level worksheet (0140).
export const TeacherStudyGenerateRequestSchema = z.object({ ...generateBase, format: z.enum([...STUDY_FORMATS, "worksheet"]), source: TeacherSourceSchema }).strict();
export type StudyGenerateRequest = Omit<z.infer<typeof TeacherStudyGenerateRequestSchema>, "source"> & { source: StudySource };

export const StudyCheckRequestSchema = z
  .object({
    institutionSlug,
    items: z
      .array(
        z
          .object({
            stem: z.string().trim().min(1).max(500),
            modelAnswer: z.string().trim().min(1).max(600),
            rubric: z.array(z.string().trim().min(1).max(200)).min(1).max(4),
            answer: z.string().trim().min(1).max(SHORT_ANSWER_MAX),
          })
          .strict(),
      )
      .min(1)
      .max(15),
  })
  .strict();

/** What the model returns for a short-answer check: one result per item, in order. */
export const StudyCheckGenerationSchema = z
  .object({
    results: z.array(z.object({ score: z.number().int().min(0).max(2), feedback: z.string().trim().min(1).max(300) }).strict()).min(1).max(15),
  })
  .strict();
export type AiCheck = z.infer<typeof StudyCheckGenerationSchema>["results"][number];

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

const title = z.string().trim().min(1).max(160);
const formatContent = <T extends { format: MaterialFormat; content?: unknown }>(d: T, ctx: z.RefinementCtx) => {
  const parsed = contentSchema(d.format).safeParse(d.content);
  if (!parsed.success) ctx.addIssue({ code: "custom", message: "content does not match the format", path: ["content"] });
};

const materialFields = {
  format: z.enum(STUDY_FORMATS),
  title,
  subjectId: uuid.optional(),
  unitId: uuid.optional(),
  sourceKind: z.enum(["unit", "paste", "resource", "lesson_plan", "textbook", "file", "revision_pack", "class_pack", "scope"]),
  resourceId: uuid.optional(),
  content: z.unknown(),
  // 0140
  sourceMaterialId: uuid.optional(),
  bundleId: uuid.optional(),
  focusUnitIds: z.array(uuid).max(12).optional(),
};

export const SaveMaterialSchema = z.object(materialFields).strict().superRefine(formatContent);
export type SaveMaterialInput = z.infer<typeof SaveMaterialSchema>;

export const TeacherSaveMaterialSchema = z
  .object({ ...materialFields, sectionIds: z.array(uuid).min(1).max(20) })
  .strict()
  .superRefine(formatContent);
export type TeacherSaveMaterialInput = z.infer<typeof TeacherSaveMaterialSchema>;

export const MaterialIdSchema = z.object({ materialId: uuid }).strict();

export const ReviewCardSchema = z.object({ materialId: uuid, cardId: z.string().regex(/^[a-z0-9-]{1,40}$/), grade: z.enum(REVIEW_GRADES) }).strict();
export type ReviewCardInput = z.infer<typeof ReviewCardSchema>;

const answer = z.union([z.number().int().min(0).max(3), z.boolean(), z.string().max(SHORT_ANSWER_MAX), z.null()]);
export const SubmitQuizSchema = z
  .object({
    materialId: uuid.optional(),
    subjectId: uuid.optional(),
    unitId: uuid.optional(),
    title,
    difficulty: z.enum(DIFFICULTIES),
    questions: z.array(QuizQuestionSchema).min(1).max(15),
    answers: z.array(answer).min(1).max(15),
    /** AI-checked short answers, one per short question in order (practice only, client-supplied). */
    aiChecks: z.array(z.object({ score: z.number().int().min(0).max(2), feedback: z.string().trim().max(300) }).strict()).max(15),
    durationSeconds: z.number().int().min(0).max(14_400),
  })
  .strict();
export type SubmitQuizInput = z.infer<typeof SubmitQuizSchema>;

export const PlanTopicSchema = z
  .object({ key: z.string().min(1).max(80), label: z.string().trim().min(1).max(160), subjectId: uuid.nullable(), unitId: uuid.nullable(), weak: z.boolean() })
  .strict();

export const SavePlanSchema = z
  .object({
    title,
    examLabel: z.string().trim().min(1).max(160).optional(),
    targetDate: isoDay,
    minutesPerDay: z.number().int().min(10).max(240),
    topics: z.array(PlanTopicSchema).min(1).max(30),
  })
  .strict();
export type SavePlanInput = z.infer<typeof SavePlanSchema>;

export const TogglePlanItemSchema = z.object({ planId: uuid, index: z.number().int().min(0).max(999), done: z.boolean() }).strict();

export const LogSessionSchema = z
  .object({
    activity: z.enum(["flashcards", "quiz", "reading", "plan"]),
    minutes: z.number().int().min(1).max(240),
    subjectId: uuid.optional(),
    materialId: uuid.optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// 0140 study help
// ---------------------------------------------------------------------------

export const MockRequestSchema = z
  .object({
    institutionSlug,
    scope: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("paper"), paperId: uuid }).strict(),
      z.object({ kind: z.literal("units"), subjectId: uuid, unitIds: z.array(uuid).min(1).max(MOCK_MAX_UNITS), durationMinutes: z.union([z.literal(MOCK_DURATIONS[0]), z.literal(MOCK_DURATIONS[1]), z.literal(MOCK_DURATIONS[2]), z.literal(MOCK_DURATIONS[3]), z.literal(MOCK_DURATIONS[4])]) }).strict(),
    ]),
    count: z.union([z.literal(MOCK_LENGTHS[0]), z.literal(MOCK_LENGTHS[1])]),
    difficulty: z.enum(DIFFICULTIES),
  })
  .strict();
export type MockRequest = z.infer<typeof MockRequestSchema>;

export const SaveMockSchema = z
  .object({ title, subjectId: uuid.optional(), content: MockContentSchema, focusUnitIds: z.array(uuid).min(1).max(12) })
  .strict();

export const SaveWorksheetSchema = z
  .object({ title, subjectId: uuid.optional(), unitId: uuid.optional(), sourceKind: z.enum(["unit", "paste", "resource", "lesson_plan", "textbook", "file"]), sourceMaterialId: uuid.optional(), content: WorksheetContentSchema })
  .strict();

export const AssignMaterialSchema = z
  .object({
    materialId: uuid,
    sectionId: uuid,
    subjectId: uuid.optional(),
    level: z.enum([...WORKSHEET_LEVELS, "all"]).optional(),
    dueAt: z.string().datetime().optional(),
    publish: z.boolean(),
  })
  .strict();
export type AssignMaterialInput = z.infer<typeof AssignMaterialSchema>;

/** A translated copy of `baseId` (re-read under RLS by the action; format and metadata come from the base, never the client). */
export const SaveVariantSchema = z.object({ baseId: uuid, title, language: z.enum(VARIANT_LANGUAGES), content: z.unknown() }).strict();
export type SaveVariantInput = z.infer<typeof SaveVariantSchema>;

export const TranslateMaterialRequestSchema = z.object({ institutionSlug, materialId: uuid, language: z.enum(VARIANT_LANGUAGES) }).strict();

export const FileConsentSchema = z.object({ agree: z.literal(true) }).strict();

export const ASK_CONTEXT_KINDS = ["material", "quiz_question", "flashcard", "general"] as const;
export const AskQuestionSchema = z
  .object({
    subjectId: uuid,
    contextKind: z.enum(ASK_CONTEXT_KINDS),
    materialId: uuid.optional(),
    contextExcerpt: z.string().trim().min(1).max(1000).optional(),
    question: z.string().trim().min(3).max(1000),
  })
  .strict();
export type AskQuestionInput = z.infer<typeof AskQuestionSchema>;

export const AnswerQuestionSchema = z.object({ questionId: uuid, answer: z.string().trim().min(1).max(2000) }).strict();

// 0140 item 8: open / save / log a scoped study session.
export const OpenScopeSchema = z.object({ scope: StudyScopeSchema, title: z.string().trim().min(1).max(120).optional() }).strict();
export const SaveScopeMessagesSchema = z.object({ itemId: uuid, messages: z.array(UIMessageRequestSchema).max(50) }).strict();
export const LogScopeTimeSchema = z.object({ itemId: uuid, minutes: z.number().int().min(1).max(180) }).strict();
