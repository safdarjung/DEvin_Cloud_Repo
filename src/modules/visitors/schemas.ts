// X07-T3 — Zod schemas for visitors module. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid, isoDate, phoneIN } from "../../lib/schemas/common.ts";

export const ID_TYPES = ["aadhaar", "driving_licence", "voter_id", "pan", "passport", "other"] as const;
export const PICKUP_RELATIONS = ["father", "mother", "grandparent", "uncle", "aunt", "sibling", "driver", "other"] as const;
export const GATE_PASS_STATUSES = ["pending", "approved", "rejected", "cancelled", "exited"] as const;

export const VISITOR_RETENTION_DAYS = 180;
export const VISITOR_PRIVACY_NOTICE = "Your name and phone are recorded for campus security and deleted after 180 days.";

export const VisitorCheckInSchema = z
  .object({
    fullName: z.string().trim().min(1).max(80),
    phone: phoneIN,
    purpose: z.string().trim().min(1).max(120),
    hostStaffId: uuid.optional(),
    meetingWith: z.string().trim().min(1).max(80).optional(),
    idType: z.enum(ID_TYPES).optional(),
    idLast4: z
      .string()
      .trim()
      .transform((val) => val.toUpperCase())
      .pipe(z.string().regex(/^[0-9A-Z]{4}$/, "idLast4 must be 4 alphanumeric characters"))
      .optional(),
  })
  .strict()
  .refine((data) => data.hostStaffId || data.meetingWith, {
    message: "Pick who they are meeting, or type a name.",
    path: ["hostStaffId"],
  })
  .refine((data) => (data.idType && data.idLast4) || (!data.idType && !data.idLast4), {
    message: "idType and idLast4 must both be provided or both omitted",
    path: ["idType"],
  });
export type VisitorCheckInInput = z.infer<typeof VisitorCheckInSchema>;

export const VisitorCheckOutSchema = z
  .object({
    id: uuid,
  })
  .strict();
export type VisitorCheckOutInput = z.infer<typeof VisitorCheckOutSchema>;

export const VisitorPurgeSchema = z.object({}).strict();
export type VisitorPurgeInput = z.infer<typeof VisitorPurgeSchema>;

export const VisitorListSchema = z
  .object({
    date: isoDate.optional(),
    onSite: z.boolean().optional(),
  })
  .strict();
export type VisitorListInput = z.infer<typeof VisitorListSchema>;

export const PickupAddSchema = z
  .object({
    studentId: uuid,
    fullName: z.string().trim().min(1).max(80),
    relation: z.enum(PICKUP_RELATIONS),
    phone: phoneIN,
  })
  .strict();
export type PickupAddInput = z.infer<typeof PickupAddSchema>;

export const PickupRemoveSchema = z
  .object({
    id: uuid,
  })
  .strict();
export type PickupRemoveInput = z.infer<typeof PickupRemoveSchema>;

export const PickupListSchema = z
  .object({
    studentId: uuid,
  })
  .strict();
export type PickupListInput = z.infer<typeof PickupListSchema>;

export const GatePassCreateSchema = z
  .object({
    studentId: uuid,
    reason: z.string().trim().min(1).max(200),
    guardianId: uuid.optional(),
    pickupPersonId: uuid.optional(),
  })
  .strict()
  .refine(
    (data) => {
      const hasGuardian = data.guardianId !== undefined;
      const hasPickup = data.pickupPersonId !== undefined;
      return (hasGuardian && !hasPickup) || (!hasGuardian && hasPickup);
    },
    {
      message: "Exactly one of guardianId or pickupPersonId is required",
      path: ["guardianId"],
    }
  );
export type GatePassCreateInput = z.infer<typeof GatePassCreateSchema>;

export const GatePassSetStatusSchema = z
  .object({
    id: uuid,
    status: z.enum(["approved", "rejected", "cancelled", "exited"]),
  })
  .strict();
export type GatePassSetStatusInput = z.infer<typeof GatePassSetStatusSchema>;

export const GatePassListSchema = z
  .object({
    status: z.enum(GATE_PASS_STATUSES).optional(),
    date: isoDate.optional(),
  })
  .strict();
export type GatePassListInput = z.infer<typeof GatePassListSchema>;
