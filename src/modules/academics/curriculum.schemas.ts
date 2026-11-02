// M10-T2 — zod schemas for curriculum.* actions. Relative + .ts import: mirrors
// src/modules/timetable/schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts"

export const CurriculumUnitUpsertSchema = z
  .object({
    id: uuid.optional(),
    gradeId: uuid,
    subjectId: uuid,
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(2000).optional(),
    sequence: z.number().int().min(1).max(200),
  })
  .strict();
export type CurriculumUnitUpsertInput = z.infer<typeof CurriculumUnitUpsertSchema>;

export const LessonPlanUpsertSchema = z
  .object({
    id: uuid.optional(),
    classSectionId: uuid,
    subjectId: uuid,
    curriculumUnitId: uuid.nullable().optional(),
    plannedOn: isoDate,
    title: z.string().trim().min(1).max(120),
    objectives: z.string().trim().min(1).max(2000),
    resources: z.string().trim().max(2000).optional(),
  })
  .strict();
export type LessonPlanUpsertInput = z.infer<typeof LessonPlanUpsertSchema>;

export const LessonPlanDeleteSchema = z
  .object({
    id: uuid,
  })
  .strict();
export type LessonPlanDeleteInput = z.infer<typeof LessonPlanDeleteSchema>;

export const MarkCoveredSchema = z
  .object({
    classSectionId: uuid,
    curriculumUnitId: uuid,
    covered: z.boolean(),
    coveredOn: isoDate.optional(),
    lessonPlanId: uuid.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((data) => data.covered === false || data.coveredOn !== undefined, {
    message: "coveredOn is required when covered is true",
    path: ["coveredOn"],
  });
export type MarkCoveredInput = z.infer<typeof MarkCoveredSchema>;

export const CoverageQuerySchema = z
  .object({
    classSectionId: uuid.optional(),
    subjectId: uuid.optional(),
  })
  .strict();
export type CoverageQueryInput = z.infer<typeof CoverageQuerySchema>;

export const SectionUnitsQuerySchema = z
  .object({
    classSectionId: uuid,
    subjectId: uuid,
  })
  .strict();
export type SectionUnitsQueryInput = z.infer<typeof SectionUnitsQuerySchema>;

export const LessonPlansQuerySchema = z
  .object({
    classSectionId: uuid,
    subjectId: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .strict()
  .refine((data) => !data.from || !data.to || data.from <= data.to, {
    message: "from must be less than or equal to to",
    path: ["from"],
  });
export type LessonPlansQueryInput = z.infer<typeof LessonPlansQuerySchema>;
