// Behaviour (features-18 #4) — Zod schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

export const BEHAVIOUR_SEVERITIES = ["low", "medium", "high"] as const;
/** Suggested categories for the form; the DB stores free text (1-40 chars). */
export const BEHAVIOUR_CATEGORIES = ["Helpfulness", "Academic effort", "Leadership", "Punctuality", "Disruption", "Uniform", "Bullying", "Other"] as const;

export const IncidentLogSchema = z
  .object({
    studentId: uuid,
    category: z.string().trim().min(1).max(40),
    severity: z.enum(BEHAVIOUR_SEVERITIES),
    /** Signed: merit +, demerit -. Always summed, never stored as a total. */
    points: z.number().int().min(-100).max(100),
    note: z.string().trim().max(500).optional(),
    occurredOn: isoDate.optional(),
  })
  .strict();
export type IncidentLogInput = z.infer<typeof IncidentLogSchema>;

export const IncidentVoidSchema = z
  .object({ incidentId: uuid, reason: z.string().trim().min(1).max(200) })
  .strict();
export type IncidentVoidInput = z.infer<typeof IncidentVoidSchema>;

export const IncidentListSchema = z
  .object({
    sectionId: uuid.optional(),
    category: z.string().trim().min(1).max(40).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: z.number().int().min(1).optional(),
  })
  .strict();
export type IncidentListInput = z.infer<typeof IncidentListSchema>;

export const PortalTimelineSchema = z.object({ studentId: uuid }).strict();
