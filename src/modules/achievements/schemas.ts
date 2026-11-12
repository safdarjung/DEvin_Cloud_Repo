// Achievements (features-18 #20) — Zod schemas. Relative + .ts imports: seed-script safe.
import { z } from "zod";
import { uuid, notFutureDate } from "../../lib/schemas/common.ts";

export const ACHIEVEMENT_CATEGORIES = ["academic", "sports", "arts", "leadership", "service", "other"] as const;
export const ACHIEVEMENT_LEVELS = ["school", "district", "state", "national", "international"] as const;

// Mirrors the 0128 check constraints (title 1-200, position 1-60, description <= 1000).
export const AchievementRecordSchema = z
  .object({
    studentId: uuid,
    title: z.string().trim().min(1).max(200),
    category: z.enum(ACHIEVEMENT_CATEGORIES),
    level: z.enum(ACHIEVEMENT_LEVELS),
    position: z.string().trim().min(1).max(60).optional(),
    eventDate: notFutureDate,
    description: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type AchievementRecordInput = z.infer<typeof AchievementRecordSchema>;

export const AchievementVerifySchema = z.object({ achievementId: uuid }).strict();
export type AchievementVerifyInput = z.infer<typeof AchievementVerifySchema>;

export const AchievementVoidSchema = z.object({ achievementId: uuid, reason: z.string().trim().min(1).max(200) }).strict();
export type AchievementVoidInput = z.infer<typeof AchievementVoidSchema>;

export const AchievementListSchema = z
  .object({
    sectionId: uuid.optional(),
    category: z.enum(ACHIEVEMENT_CATEGORIES).optional(),
    level: z.enum(ACHIEVEMENT_LEVELS).optional(),
    verified: z.enum(["yes", "no"]).optional(),
    page: z.number().int().min(1).optional(),
  })
  .strict();
export type AchievementListInput = z.infer<typeof AchievementListSchema>;

export const StudentPortfolioSchema = z.object({ studentId: uuid }).strict();
export const AchievementSummarySchema = z.object({}).strict();
