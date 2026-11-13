// Phase 3 (15-learning-exam-system-plan.md) — question paper schemas. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";
import { DifficultySchema, QuestionTypeSchema } from "../question-bank/schemas.ts";

const text = (max: number) => z.string().trim().min(1).max(max);
const marks = z.number().positive().max(100).multipleOf(0.01);

export const PaperStatusSchema = z.enum(["draft", "in_review", "approved", "published", "archived"]);
export type PaperStatus = z.infer<typeof PaperStatusSchema>;

// Blueprint (0149 header). School-defined: no board is assumed.
export const BlueprintRowSchema = z
  .object({ type: QuestionTypeSchema, count: z.number().int().min(1).max(100), marks, difficulty: DifficultySchema.optional() })
  .strict();
export const BlueprintSchema = z
  .object({
    sections: z
      .array(
        z
          .object({
            title: text(200),
            instructions: text(2000).optional(),
            chooseCount: z.number().int().min(1).max(200).optional(),
            rows: z.array(BlueprintRowSchema).min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    chapterWeights: z.array(z.object({ curriculumUnitId: uuid, percent: z.number().min(0).max(100) }).strict()).max(50).optional(),
    difficultyMix: z
      .object({ easy: z.number().min(0).max(100).optional(), medium: z.number().min(0).max(100).optional(), hard: z.number().min(0).max(100).optional() })
      .strict()
      .optional(),
  })
  .strict();
export type Blueprint = z.infer<typeof BlueprintSchema>;

const header = {
  title: text(200),
  examType: text(60).nullable().optional(),
  examDate: isoDate.nullable().optional(),
  durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  totalMarks: z.number().positive().max(1000).multipleOf(0.01),
  passMarks: z.number().min(0).max(1000).multipleOf(0.01).default(0),
  instructions: text(4000).nullable().optional(),
  negativeMarking: z.number().min(0).max(10).multipleOf(0.01).default(0),
  sectionId: uuid.nullable().optional(),
  examId: uuid.nullable().optional(),
  examPaperId: uuid.nullable().optional(),
  blueprint: BlueprintSchema.nullable().optional(),
};

export const PaperCreateSchema = z
  .object({ academicYearId: uuid, gradeId: uuid, subjectId: uuid, templateId: uuid.optional(), ...header })
  .strict()
  .refine((p) => p.passMarks <= p.totalMarks, { path: ["passMarks"], message: "Pass marks cannot exceed total marks" });
export type PaperCreateInput = z.infer<typeof PaperCreateSchema>;

// Header patch: every field optional; grade/subject/year stay fixed (duplicate to move a paper).
export const PaperUpdateSchema = z
  .object({
    id: uuid,
    title: header.title.optional(),
    examType: header.examType,
    examDate: header.examDate,
    durationMinutes: header.durationMinutes,
    totalMarks: header.totalMarks.optional(),
    passMarks: z.number().min(0).max(1000).multipleOf(0.01).optional(),
    instructions: header.instructions,
    negativeMarking: z.number().min(0).max(10).multipleOf(0.01).optional(),
    sectionId: header.sectionId,
    examId: header.examId,
    examPaperId: header.examPaperId,
    blueprint: header.blueprint,
  })
  .strict();
export type PaperUpdateInput = z.infer<typeof PaperUpdateSchema>;

export const PaperIdSchema = z.object({ id: uuid }).strict();
export type PaperIdInput = z.infer<typeof PaperIdSchema>;

export const PaperTransitionSchema = z.object({ id: uuid, reason: text(500).optional() }).strict();
export type PaperTransitionInput = z.infer<typeof PaperTransitionSchema>;

/** expectedUpdatedAt: the paper's updated_at the approver reviewed; a later edit (header, section or item) refuses with conflict. */
export const ApprovePaperSchema = PaperTransitionSchema.extend({ expectedUpdatedAt: z.iso.datetime({ offset: true }).optional() }).strict();
export type ApprovePaperInput = z.infer<typeof ApprovePaperSchema>;

export const SectionAddSchema = z
  .object({
    paperId: uuid,
    title: text(200),
    instructions: text(2000).nullable().optional(),
    chooseCount: z.number().int().min(1).max(200).nullable().optional(),
  })
  .strict();
export type SectionAddInput = z.infer<typeof SectionAddSchema>;

export const SectionUpdateSchema = z
  .object({
    id: uuid,
    title: text(200).optional(),
    instructions: text(2000).nullable().optional(),
    chooseCount: z.number().int().min(1).max(200).nullable().optional(),
  })
  .strict();
export type SectionUpdateInput = z.infer<typeof SectionUpdateSchema>;

export const ReorderSectionsSchema = z.object({ paperId: uuid, sectionIds: z.array(uuid).min(1).max(50) }).strict();
export type ReorderSectionsInput = z.infer<typeof ReorderSectionsSchema>;

/** Drag/drop: the full new order of one section (items may come from another section of the same paper). */
export const ReorderItemsSchema = z.object({ sectionId: uuid, itemIds: z.array(uuid).min(1).max(200) }).strict();
export type ReorderItemsInput = z.infer<typeof ReorderItemsSchema>;

export const AddItemsFromBankSchema = z.object({ sectionId: uuid, questionIds: z.array(uuid).min(1).max(100) }).strict();
export type AddItemsFromBankInput = z.infer<typeof AddItemsFromBankSchema>;

/**
 * `item` is a question-bank question shape without gradeId/subjectId (they
 * come from the paper); the handler validates it with QuestionCreateSchema so
 * the per-type rules are shared with the bank.
 */
export const AddManualItemSchema = z.object({ sectionId: uuid, item: z.record(z.string(), z.unknown()) }).strict();
export type AddManualItemInput = z.infer<typeof AddManualItemSchema>;

export const UpdateItemSchema = z.object({ id: uuid, item: z.record(z.string(), z.unknown()) }).strict();
export type UpdateItemInput = z.infer<typeof UpdateItemSchema>;

export const ItemIdSchema = z.object({ id: uuid }).strict();
export type ItemIdInput = z.infer<typeof ItemIdSchema>;

export const ReplaceItemSchema = z.object({ id: uuid, questionId: uuid }).strict();
export type ReplaceItemInput = z.infer<typeof ReplaceItemSchema>;

/** Items sharing a group inside one section are OR-alternatives; null ungroups them. */
export const SetChoiceGroupSchema = z
  .object({ itemIds: z.array(uuid).min(1).max(10), choiceGroup: z.number().int().min(1).max(100).nullable() })
  .strict();
export type SetChoiceGroupInput = z.infer<typeof SetChoiceGroupSchema>;

export const TemplateSaveSchema = z
  .object({
    id: uuid.optional(),
    name: text(120),
    gradeId: uuid.nullable().optional(),
    subjectId: uuid.nullable().optional(),
    examType: text(60).nullable().optional(),
    durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
    instructions: text(4000).nullable().optional(),
    blueprint: BlueprintSchema,
  })
  .strict();
export type TemplateSaveInput = z.infer<typeof TemplateSaveSchema>;

export const ApplyTemplateSchema = z.object({ paperId: uuid, templateId: uuid }).strict();
export type ApplyTemplateInput = z.infer<typeof ApplyTemplateSchema>;

export const PaperListSchema = z
  .object({
    gradeId: uuid.optional(),
    subjectId: uuid.optional(),
    examId: uuid.optional(),
    status: PaperStatusSchema.optional(),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(50),
  })
  .strict();
export type PaperListInput = z.infer<typeof PaperListSchema>;

export const TemplateListSchema = z.object({ gradeId: uuid.optional(), subjectId: uuid.optional() }).strict();
export type TemplateListInput = z.infer<typeof TemplateListSchema>;

export const WhereUsedSchema = z.object({ questionId: uuid }).strict();
export type WhereUsedInput = z.infer<typeof WhereUsedSchema>;

export const PrintKindSchema = z.enum(["paper", "key", "scheme"]);
export type PrintKind = z.infer<typeof PrintKindSchema>;
export const PrintSetSchema = z.enum(["A", "B", "C", "D"]);
export type PrintSet = z.infer<typeof PrintSetSchema>;
