// M06-T5 — zod schemas for announcement.create / announcement.publish /
// notification.preferences.set. Relative + .ts import: mirrors
// src/modules/documents/schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

// Mirrors migration 0068's check constraints exactly.
export const ANNOUNCEMENT_CATEGORIES = ["general", "academic", "event", "holiday", "fees", "emergency"] as const;
export const AUDIENCE_ROLES = [
  "owner", "principal", "admin", "admissions", "accountant",
  "exam_controller", "teacher", "student", "guardian",
] as const;
export const PREFERENCE_CATEGORIES = ["attendance", "academic", "admissions", "announcement"] as const;
export const PREFERENCE_CHANNELS = ["sms", "email"] as const;

export const AudienceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("school") }).strict(),
  z.object({ type: z.literal("role"), role: z.enum(AUDIENCE_ROLES) }).strict(),
  z.object({ type: z.literal("grade"), gradeId: uuid }).strict(),
  z.object({ type: z.literal("section"), classSectionId: uuid }).strict(),
]);
export type AudienceInput = z.infer<typeof AudienceSchema>;

export const CreateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(4000),
    category: z.enum(ANNOUNCEMENT_CATEGORIES).optional(),
    audiences: z.array(AudienceSchema).min(1).max(20),
  })
  .strict();
export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementSchema>;

export const PublishAnnouncementSchema = z.object({ announcementId: uuid }).strict();
export type PublishAnnouncementInput = z.infer<typeof PublishAnnouncementSchema>;

export const SetNotificationPreferenceSchema = z
  .object({
    category: z.enum(PREFERENCE_CATEGORIES),
    channel: z.enum(PREFERENCE_CHANNELS),
    enabled: z.boolean(),
  })
  .strict();
export type SetNotificationPreferenceInput = z.infer<typeof SetNotificationPreferenceSchema>;
