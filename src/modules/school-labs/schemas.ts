// School labs (migration 0126) — Zod schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";
import { rupeesToPaise } from "../expenses/schemas.ts";

export const LAB_KINDS = ["science", "computer", "language", "other"] as const;
export const EQUIPMENT_KINDS = ["equipment", "chemical", "consumable"] as const;
export const HAZARD_CLASSES = ["flammable", "corrosive", "toxic", "oxidising", "explosive", "irritant", "compressed_gas", "health_hazard", "environmental"] as const;
export const EQUIPMENT_CONDITIONS = ["good", "fair", "needs_repair", "out_of_service"] as const;
export const INCIDENT_KINDS = ["breakage", "safety"] as const;
export const INCIDENT_SEVERITIES = ["low", "medium", "high"] as const;

const MAX_UTILISATION_DAYS = 366;

const text = (max: number) => z.string().trim().min(1).max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const labFields = { name: text(80), kind: z.enum(LAB_KINDS), capacity: z.number().int().min(1).max(500) };
export const LabCreateSchema = z.object(labFields).strict();
export const LabUpdateSchema = z.object({ id: uuid, ...labFields, isActive: z.boolean() }).strict();

const quantity = z
  .number()
  .min(0)
  .max(999_999_999)
  .refine((n) => Math.round(n * 1000) / 1000 === n, "At most 3 decimals.");
const equipmentFields = {
  labId: uuid,
  name: text(120),
  kind: z.enum(EQUIPMENT_KINDS),
  quantity,
  unit: text(20),
  hazardClass: z.enum(HAZARD_CLASSES).nullable(),
  expiryOn: isoDate.nullable(),
  condition: z.enum(EQUIPMENT_CONDITIONS),
};
export const EquipmentCreateSchema = z.object(equipmentFields).strict();
export const EquipmentUpdateSchema = z.object({ id: uuid, ...equipmentFields }).strict();

export const BookingCreateSchema = z
  .object({ labId: uuid, classSectionId: uuid, subjectId: uuid, date: isoDate, periodId: uuid, purpose: optText(200), staffId: uuid.optional() })
  .strict();
export const BookingCancelSchema = z.object({ bookingId: uuid }).strict();

export const ExperimentLogSchema = z.object({ bookingId: uuid, title: text(160), notes: optText(2000) }).strict();
export const ExperimentCompleteSchema = z.object({ id: uuid, completed: z.boolean() }).strict();

/** Rupee text ("250", "250.50") -> integer paise; empty -> undefined. Strict: no sign, commas or 3+ decimals. */
const optionalRupees = z
  .string()
  .trim()
  .optional()
  .transform((text, c) => {
    if (!text) return undefined;
    const paise = rupeesToPaise(text);
    if (paise === null) {
      c.addIssue({ code: "custom", message: "Enter rupees like 250 or 250.50." });
      return z.NEVER;
    }
    return paise;
  });

export const IncidentRecordSchema = z
  .object({
    labId: uuid,
    bookingId: uuid.optional(),
    kind: z.enum(INCIDENT_KINDS),
    severity: z.enum(INCIDENT_SEVERITIES),
    description: text(1000),
    cost: optionalRupees,
  })
  .strict()
  .transform(({ cost, ...rest }) => ({ ...rest, costPaise: cost }));

const dayMs = 86_400_000;
export const UtilisationQuerySchema = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((d) => d.to >= d.from, { message: "End date must be on or after the start.", path: ["to"] })
  .refine((d) => (Date.parse(d.to) - Date.parse(d.from)) / dayMs < MAX_UTILISATION_DAYS, { message: "Range is at most 366 days.", path: ["to"] });

export const WeekQuerySchema = z.object({ labId: uuid, weekStart: isoDate }).strict();
export const LabIdQuerySchema = z.object({ labId: uuid }).strict();
export const LabsEmptySchema = z.object({}).strict();

export type LabCreateInput = z.infer<typeof LabCreateSchema>;
export type BookingCreateInput = z.infer<typeof BookingCreateSchema>;
export type UtilisationQueryInput = z.infer<typeof UtilisationQuerySchema>;
