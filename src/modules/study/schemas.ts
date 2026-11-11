// Study studio request and action schemas. Every object is .strict().
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { DIFFICULTIES, QUIZ_LENGTHS, QUIZ_TYPES, QuizQuestionSchema, STUDY_FORMATS, contentSchema, type StudyFormat } from "@/modules/study/formats";
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

export const StudentSourceSchema = z.discriminatedUnion("kind", [unitSource, pasteSource, resourceSource]);
export const TeacherSourceSchema = z.discriminatedUnion("kind", [unitSource, pasteSource, resourceSource, lessonPlanSource]);
export type StudySource = z.infer<typeof TeacherSourceSchema>;

const QuizRequestSchema = z
  .object({
    count: z.union([z.literal(QUIZ_LENGTHS[0]), z.literal(QUIZ_LENGTHS[1]), z.literal(QUIZ_LENGTHS[2])]),
    difficulty: z.enum(DIFFICULTIES),
    types: z.array(z.enum(QUIZ_TYPES)).min(1).max(3),
  })
  .strict();

const generateBase = { institutionSlug, format: z.enum(STUDY_FORMATS), quiz: QuizRequestSchema.optional() };
export const StudyGenerateRequestSchema = z.object({ ...generateBase, source: StudentSourceSchema }).strict();
export const TeacherStudyGenerateRequestSchema = z.object({ ...generateBase, source: TeacherSourceSchema }).strict();
export type StudyGenerateRequest = z.infer<typeof TeacherStudyGenerateRequestSchema>;

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
const formatContent = <T extends { format: StudyFormat; content?: unknown }>(d: T, ctx: z.RefinementCtx) => {
  const parsed = contentSchema(d.format).safeParse(d.content);
  if (!parsed.success) ctx.addIssue({ code: "custom", message: "content does not match the format", path: ["content"] });
};

const materialFields = {
  format: z.enum(STUDY_FORMATS),
  title,
  subjectId: uuid.optional(),
  unitId: uuid.optional(),
  sourceKind: z.enum(["unit", "paste", "resource", "lesson_plan"]),
  resourceId: uuid.optional(),
  content: z.unknown(),
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
