// Features-18 #6 — Zod schemas for clubs & houses. Relative import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

const optText = (max: number) => z.string().trim().max(max).optional();
const capacity = z.number().int().min(1).max(1000);

export const ClubCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: optText(500),
    patronStaffId: uuid.optional(),
    capacity: capacity.optional(),
  })
  .strict();
export type ClubCreateInput = z.infer<typeof ClubCreateSchema>;

export const ClubUpdateSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    patronStaffId: uuid.nullable().optional(),
    capacity: capacity.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type ClubUpdateInput = z.infer<typeof ClubUpdateSchema>;

const isoDateTime = z.string().datetime({ offset: true });

export const ClubEventCreateSchema = z
  .object({
    clubId: uuid,
    title: z.string().trim().min(1).max(120),
    description: optText(500),
    venue: z.string().trim().min(1).max(120).optional(),
    startsAt: isoDateTime,
    endsAt: isoDateTime.optional(),
    signupClosesAt: isoDateTime.optional(),
    capacity: capacity.optional(),
  })
  .strict()
  .refine((d) => !d.endsAt || new Date(d.endsAt) > new Date(d.startsAt), { message: "Must end after it starts", path: ["endsAt"] })
  .refine((d) => !d.signupClosesAt || new Date(d.signupClosesAt) <= new Date(d.startsAt), {
    message: "Sign-up must close before the event starts",
    path: ["signupClosesAt"],
  });
export type ClubEventCreateInput = z.infer<typeof ClubEventCreateSchema>;

export const ClubEventCancelSchema = z.object({ id: uuid }).strict();
export type ClubEventCancelInput = z.infer<typeof ClubEventCancelSchema>;

export const HouseCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    colour: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/, "Use a hex colour like #2563EB")
      .optional(),
  })
  .strict();
export type HouseCreateInput = z.infer<typeof HouseCreateSchema>;

export const HouseAssignSchema = z.object({ houseId: uuid, studentId: uuid }).strict();
export type HouseAssignInput = z.infer<typeof HouseAssignSchema>;

export const HouseUnassignSchema = z.object({ studentId: uuid }).strict();
export type HouseUnassignInput = z.infer<typeof HouseUnassignSchema>;

export const ClubMembershipSchema = z.object({ clubId: uuid, studentId: uuid }).strict();
export type ClubMembershipInput = z.infer<typeof ClubMembershipSchema>;

export const EventSignupSchema = z.object({ eventId: uuid, studentId: uuid }).strict();
export type EventSignupInput = z.infer<typeof EventSignupSchema>;

export const AwardPointsSchema = z
  .object({
    houseId: uuid,
    points: z
      .number()
      .int()
      .min(-100)
      .max(100)
      .refine((n) => n !== 0, "Points cannot be zero"),
    reason: z.string().trim().min(1).max(200),
    studentId: uuid.optional(),
  })
  .strict();
export type AwardPointsInput = z.infer<typeof AwardPointsSchema>;

export const ClubsEmptySchema = z.object({}).strict();
export const ClubMembersQuerySchema = z.object({ clubId: uuid }).strict();
