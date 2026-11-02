// M14-T1 — student lifecycle event schemas.
import { z } from "zod";
import { isoDate, uuid } from "@/lib/schemas/common";

export const PromoteSchema = z
  .object({
    fromYearId: uuid,
    toYearId: uuid,
    mappings: z
      .array(
        z.object({
          fromSectionId: uuid,
          toSectionId: uuid.nullable(),
        })
      )
      .min(1)
      .max(200),
    overrides: z
      .array(
        z.object({
          studentId: uuid,
          toSectionId: uuid,
        })
      )
      .max(500)
      .optional(),
    exclude: z.array(uuid).max(2000).optional(),
  })
  .strict()
  .refine(
    (data) => data.fromYearId !== data.toYearId,
    "fromYearId and toYearId must be different"
  )
  .refine(
    (data) => {
      const fromSectionIds = data.mappings.map((m) => m.fromSectionId);
      return new Set(fromSectionIds).size === fromSectionIds.length;
    },
    "Duplicate fromSectionId in mappings"
  )
  .refine(
    (data) => {
      if (!data.overrides || !data.exclude) return true;
      const overrideIds = new Set(data.overrides.map((o) => o.studentId));
      const excludeIds = new Set(data.exclude);
      for (const id of overrideIds) {
        if (excludeIds.has(id)) return false;
      }
      return true;
    },
    "A student cannot be in both overrides and exclude"
  );

export type PromoteInput = z.infer<typeof PromoteSchema>;

export const TransferSchema = z
  .object({
    studentId: uuid,
    reason: z.string().trim().min(3).max(500),
    leftOn: isoDate.optional(),
    destinationSchool: z.string().trim().min(2).max(200),
    conduct: z.string().trim().max(100).optional(),
  })
  .strict();

export type TransferInput = z.infer<typeof TransferSchema>;

export const WithdrawSchema = z
  .object({
    studentId: uuid,
    reason: z.string().trim().min(3).max(500),
    leftOn: isoDate.optional(),
    destinationSchool: z.string().trim().min(2).max(200).optional(),
    conduct: z.string().trim().max(100).optional(),
  })
  .strict();

export type WithdrawInput = z.infer<typeof WithdrawSchema>;

export const HistorySchema = z
  .object({
    studentId: uuid,
  })
  .strict();

export type HistoryInput = z.infer<typeof HistorySchema>;
