// Alumni (features-18 #14) — Zod schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const ALUMNI_PAGE_SIZE = 50;

// Empty string means "clear the field" (stored as null). Mirrors the 0123 check constraints.
const optionalText = (max: number) =>
  z.string().trim().max(max).transform((v) => (v === "" ? null : v)).nullable();

export const AlumniSyncSchema = z.object({}).strict();

export const AlumniUpdateSchema = z
  .object({
    id: uuid,
    contactEmail: z.string().trim().max(254).email().or(z.literal("")).transform((v) => (v === "" ? null : v)).nullable(),
    contactPhone: z.string().trim().regex(/^[6-9][0-9]{9}$/, "10-digit Indian mobile number").or(z.literal("")).transform((v) => (v === "" ? null : v)).nullable(),
    occupation: optionalText(120),
    city: optionalText(80),
  })
  .strict();
export type AlumniUpdateInput = z.infer<typeof AlumniUpdateSchema>;

export const AlumniListSchema = z
  .object({
    q: z.string().trim().min(1).max(80).optional(),
    batchYear: z.number().int().min(1900).max(2200).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    page: z.number().int().min(1).optional(),
  })
  .strict();
export type AlumniListInput = z.infer<typeof AlumniListSchema>;

export const AlumniCountsSchema = z.object({}).strict();
