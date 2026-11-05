// M20-T2 — Zod schemas for mastery.* queries and actions. Relative + .ts import: mirrors
// src/modules/notifications/announcements.schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts"

export const INTERVENTION_STATUSES = ["proposed", "active", "review", "closed"] as const;

// Query schemas
export const HeatmapQuerySchema = z
  .object({
    classSectionId: uuid.optional(),
    subjectId: uuid.optional(),
  })
  .strict();
export type HeatmapQueryInput = z.infer<typeof HeatmapQuerySchema>;

export const StudentGapsQuerySchema = z
  .object({
    studentId: uuid,
  })
  .strict();
export type StudentGapsQueryInput = z.infer<typeof StudentGapsQuerySchema>;

export const SuccessRowsQuerySchema = z
  .object({
    classSectionId: uuid,
  })
  .strict();
export type SuccessRowsQueryInput = z.infer<typeof SuccessRowsQuerySchema>;

export const InterventionsQuerySchema = z
  .object({
    studentId: uuid.optional(),
    classSectionId: uuid.optional(),
    status: z.enum(INTERVENTION_STATUSES).optional(),
  })
  .strict();
export type InterventionsQueryInput = z.infer<typeof InterventionsQuerySchema>;

// Action schemas
export const SetPaperUnitsSchema = z
  .object({
    paperId: uuid,
    unitIds: z.array(uuid).max(20),
  })
  .strict()
  .refine(
    (data) => new Set(data.unitIds).size === data.unitIds.length,
    {
      message: "unitIds must be distinct",
      path: ["unitIds"],
    }
  );
export type SetPaperUnitsInput = z.infer<typeof SetPaperUnitsSchema>;

export const InterventionStepSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    due: isoDate,
    done: z.boolean(),
  })
  .strict();
export type InterventionStepInput = z.infer<typeof InterventionStepSchema>;

export const UpdateInterventionSchema = z
  .object({
    id: uuid,
    goal: z.string().trim().min(1).max(300).optional(),
    steps: z.array(InterventionStepSchema).min(1).max(8).optional(),
    reviewDate: isoDate.optional(),
    status: z.enum(INTERVENTION_STATUSES).optional(),
  })
  .strict()
  .refine(
    (data) => {
      // At least one field besides id must be provided
      return (
        data.goal !== undefined ||
        data.steps !== undefined ||
        data.reviewDate !== undefined ||
        data.status !== undefined
      );
    },
    {
      message: "At least one field besides id must be provided",
    }
  );
export type UpdateInterventionInput = z.infer<typeof UpdateInterventionSchema>;
