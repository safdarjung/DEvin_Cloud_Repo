// M07-T3 — zod schemas for timetable.* actions. Relative + .ts import: mirrors
// src/modules/notifications/announcements.schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts"

const timePattern = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Invalid time format, use HH:MM");

export const RoomUpsertSchema = z
  .object({
    id: uuid.optional(),
    name: z.string().trim().min(1).max(40),
    capacity: z.number().int().min(1).max(500),
    kind: z.string().trim().max(30).optional(),
  })
  .strict();
export type RoomUpsertInput = z.infer<typeof RoomUpsertSchema>;

export const PeriodUpsertSchema = z
  .object({
    id: uuid.optional(),
    seq: z.number().int().min(1).max(12),
    name: z.string().trim().min(1).max(30),
    startsAt: timePattern,
    endsAt: timePattern,
    isBreak: z.boolean().optional(),
  })
  .strict()
  .refine((data) => data.endsAt > data.startsAt, {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type PeriodUpsertInput = z.infer<typeof PeriodUpsertSchema>;

export const VersionCreateSchema = z
  .object({
    academicYearId: uuid,
    name: z.string().trim().min(1).max(60),
    copyFromVersionId: uuid.optional(),
  })
  .strict();
export type VersionCreateInput = z.infer<typeof VersionCreateSchema>;

export const SlotInputSchema = z
  .object({
    classSectionId: uuid,
    weekday: z.number().int().min(1).max(6),
    periodId: uuid,
    subjectId: uuid,
    teacherId: uuid,
    roomId: uuid.optional(),
  })
  .strict();
export type SlotInput = z.infer<typeof SlotInputSchema>;

export const SaveSlotsSchema = z
  .object({
    versionId: uuid,
    slots: z.array(SlotInputSchema).min(1).max(500),
    replaceSectionIds: z.array(uuid).max(100).optional(),
  })
  .strict();
export type SaveSlotsInput = z.infer<typeof SaveSlotsSchema>;

export const PublishVersionSchema = z.object({ versionId: uuid }).strict();
export type PublishVersionInput = z.infer<typeof PublishVersionSchema>;

export const ForSectionSchema = z
  .object({
    classSectionId: uuid,
    versionId: uuid.optional(),
  })
  .strict();
export type ForSectionInput = z.infer<typeof ForSectionSchema>;

export const ForTeacherSchema = z
  .object({
    staffId: uuid.optional(),
    versionId: uuid.optional(),
  })
  .strict();
export type ForTeacherInput = z.infer<typeof ForTeacherSchema>;

export const ForStudentSchema = z.object({ studentId: uuid }).strict();
export type ForStudentInput = z.infer<typeof ForStudentSchema>;

export const VersionQuerySchema = z.object({ versionId: uuid }).strict();
export type VersionQueryInput = z.infer<typeof VersionQuerySchema>;
