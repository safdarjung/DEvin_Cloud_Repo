// M07-T3 — zod schemas for timetable.* actions. Relative + .ts import: mirrors
// src/modules/notifications/announcements.schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts"
import { TimetableRulesSchema } from "./rules.ts";

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
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type SaveSlotsInput = z.infer<typeof SaveSlotsSchema>;

// 0141: `note` is required (checked in the action) when the draft still breaks
// a rule, and by the database when restoring an archived version.
export const PublishVersionSchema = z.object({ versionId: uuid, note: z.string().trim().max(300).optional() }).strict();
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

// M08-T6: Substitution schemas
export const SubstitutionAssignSchema = z
  .object({
    slotId: uuid,
    date: isoDate,
    substituteId: uuid,
    leaveRequestId: uuid.optional(),
    // 0141: the reason shown to leaders and the two teachers ("Ms Iyer is on leave"); students/guardians get a fixed line.
    note: z.string().trim().min(1, "Say why this cover is needed.").max(200),
  })
  .strict();
export type SubstitutionAssignInput = z.infer<typeof SubstitutionAssignSchema>;

export const SubstitutionCancelSchema = z.object({ substitutionId: uuid }).strict();
export type SubstitutionCancelInput = z.infer<typeof SubstitutionCancelSchema>;

export const SubstitutionCandidatesSchema = z
  .object({
    slotId: uuid,
    date: isoDate,
  })
  .strict();
export type SubstitutionCandidatesInput = z.infer<typeof SubstitutionCandidatesSchema>;

export const CoverNeededSchema = z
  .object({
    date: isoDate.optional(),
  })
  .strict();
export type CoverNeededInput = z.infer<typeof CoverNeededSchema>;

export const SubstitutionsSchema = z
  .object({
    date: isoDate.optional(),
  })
  .strict();
export type SubstitutionsInput = z.infer<typeof SubstitutionsSchema>;

// M25-T3: timetable.suggest (read-only fill proposals for a draft version)
export const SuggestFillSchema = z
  .object({
    versionId: uuid,
    classSectionIds: z.array(uuid).min(1).max(100).optional(),
    limit: z.number().int().min(1).max(200).default(200),
  })
  .strict();
export type SuggestFillInput = z.infer<typeof SuggestFillSchema>;

// 0141: timetable control — change log, rules, snapshots, rollback, day view.
const CellContentSchema = z.object({ subjectId: uuid, teacherId: uuid, roomId: uuid.nullable().optional() }).strict();

export const CellChangeSchema = z
  .object({
    classSectionId: uuid,
    weekday: z.number().int().min(1).max(6),
    periodId: uuid,
    /** null clears the period. */
    after: CellContentSchema.nullable(),
    reason: z.string().trim().max(500).optional(),
    rules: z.array(z.string().max(40)).max(12).optional(),
  })
  .strict();
export type CellChangeInput = z.infer<typeof CellChangeSchema>;

export const ApplyChangesSchema = z
  .object({
    versionId: uuid,
    kind: z.enum(["manual", "suggestion"]),
    changes: z.array(CellChangeSchema).min(1).max(200),
    note: z.string().trim().max(300).optional(),
  })
  .strict();
export type ApplyChangesInput = z.infer<typeof ApplyChangesSchema>;

export const RollbackChangeSchema = z.object({ changeId: uuid, note: z.string().trim().max(300).optional() }).strict();
export type RollbackChangeInput = z.infer<typeof RollbackChangeSchema>;

export const SetRulesSchema = z
  .object({ rules: TimetableRulesSchema, reason: z.string().trim().min(1, "Say why the rules are changing.").max(300) })
  .strict();
export type SetRulesInput = z.infer<typeof SetRulesSchema>;

export const SnapshotCreateSchema = z.object({ versionId: uuid, name: z.string().trim().min(1).max(60) }).strict();
export type SnapshotCreateInput = z.infer<typeof SnapshotCreateSchema>;

export const SnapshotRestoreSchema = z.object({ snapshotId: uuid, note: z.string().trim().max(300).optional() }).strict();
export type SnapshotRestoreInput = z.infer<typeof SnapshotRestoreSchema>;

export const CHANGE_KINDS = ["manual", "suggestion", "substitution", "rollback", "restore", "publish", "rules"] as const;

export const ChangesQuerySchema = z
  .object({
    versionId: uuid.optional(),
    classSectionId: uuid.optional(),
    teacherId: uuid.optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    kind: z.enum(CHANGE_KINDS).optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export type ChangesQueryInput = z.infer<typeof ChangesQuerySchema>;

export const DayViewSchema = z
  .object({ date: isoDate.optional(), classSectionId: uuid.optional(), teacherId: uuid.optional(), studentId: uuid.optional() })
  .strict();
export type DayViewInput = z.infer<typeof DayViewSchema>;

export const CompareVersionsSchema = z.object({ fromVersionId: uuid, toVersionId: uuid }).strict();
export type CompareVersionsInput = z.infer<typeof CompareVersionsSchema>;
