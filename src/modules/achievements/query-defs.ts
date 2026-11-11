// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/achievements.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { AchievementListSchema, AchievementSummarySchema, StudentPortfolioSchema } from "./schemas";
import { achievementSummary, listAchievements, studentPortfolio } from "./queries";

/** Rows carry student names: local-only for the AI agent. */
export const achievementsListQuery = defineQuery({
  name: "achievements.list",
  module: "achievements",
  schema: AchievementListSchema,
  permission: "achievement.read",
  handler: (input, ctx) => listAchievements(ctx, input),
});

/** One student's non-voided achievements with verified flag. Local-only (names). */
export const achievementsPortfolioQuery = defineQuery({
  name: "achievements.portfolio",
  module: "achievements",
  schema: StudentPortfolioSchema,
  permission: "achievement.read",
  handler: (input, ctx) => studentPortfolio(ctx, input.studentId),
});

/** Name-free aggregate: achievement counts by category and level. */
export const achievementsSummaryQuery = defineQuery({
  name: "achievements.summary",
  module: "achievements",
  schema: AchievementSummarySchema,
  permission: "achievement.read",
  handler: (_input, ctx) => achievementSummary(ctx),
});
