// Health module schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";

export const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const VISIT_OUTCOMES = ["returned_to_class", "rested", "sent_home", "referred"] as const;

const optionalText = (max: number) => z.string().trim().max(max).optional();

export const HealthProfileSaveSchema = z
  .object({
    studentId: uuid,
    bloodGroup: z.enum(BLOOD_GROUPS).nullable().optional(),
    allergies: optionalText(500),
    conditions: optionalText(500),
    emergencyNote: optionalText(500),
  })
  .strict();
export type HealthProfileSaveInput = z.infer<typeof HealthProfileSaveSchema>;

export const HealthVisitAddSchema = z
  .object({
    studentId: uuid,
    complaint: z.string().trim().min(1).max(300),
    treatment: optionalText(500),
    outcome: z.enum(VISIT_OUTCOMES).default("returned_to_class"),
    visitedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export type HealthVisitAddInput = z.input<typeof HealthVisitAddSchema>;

export const VaccinationAddSchema = z
  .object({
    studentId: uuid,
    vaccine: z.string().trim().min(1).max(80),
    dose: z.string().trim().min(1).max(20).optional(),
    administeredOn: isoDate,
    notes: optionalText(300),
  })
  .strict();
export type VaccinationAddInput = z.infer<typeof VaccinationAddSchema>;

export const HealthStudentSchema = z.object({ studentId: uuid }).strict();
