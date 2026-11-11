// Duties — Zod schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";

const name = z.string().trim().min(1).max(60);
const slotsPerDay = z.number().int().min(1).max(20);
const MAX_ROSTER_DAYS = 62; // matches generate_duty_roster

const spanDays = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;

export const DutyEmptySchema = z.object({}).strict();
export const DutyTypeCreateSchema = z.object({ name, slotsPerDay }).strict();
export const DutyTypeUpdateSchema = z.object({ id: uuid, name, slotsPerDay, isActive: z.boolean() }).strict();
export const DutyRangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .strict()
  .refine((d) => d.to >= d.from && spanDays(d.from, d.to) < MAX_ROSTER_DAYS, { message: `Pick a range of 1 to ${MAX_ROSTER_DAYS} days.`, path: ["to"] });
export const DutySetAssignmentSchema = z
  .object({ assignmentId: uuid, staffId: uuid.optional(), cancel: z.boolean().optional() })
  .strict()
  .refine((d) => (d.staffId !== undefined) !== (d.cancel === true), { message: "Choose either a new staff member or cancel.", path: ["staffId"] });
export const DutySwapRequestSchema = z.object({ assignmentId: uuid, toStaffId: uuid }).strict();
export const DutySwapRespondSchema = z.object({ requestId: uuid, accept: z.boolean() }).strict();
export const DutySwapCancelSchema = z.object({ requestId: uuid }).strict();

export type DutyRangeInput = z.infer<typeof DutyRangeSchema>;
