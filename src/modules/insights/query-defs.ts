// M19-T18/T19 — read-only wrappers over ./queries.ts and ./derived.ts,
// exposed at /api/v1/query/insights.<fn> (mirrors
// src/modules/timetable/query-defs.ts). All gate on insight.read; RLS
// (0092) does the real narrowing.
import { z } from "zod";
import { defineQuery } from "@/lib/actions/define-query";
import { InsightCardsSchema, InsightIdSchema, ListInsightsSchema } from "./schemas";
import { listInsightActions, listInsights } from "./queries";
import { insightCards, priorityActions, riskIndicators } from "./derived";
import { readBriefing } from "./briefings";

export const insightsListQuery = defineQuery({
  name: "insights.list",
  module: "insights",
  schema: ListInsightsSchema,
  permission: "insight.read",
  handler: (input, ctx) => listInsights(ctx, input),
});

export const insightsActionsQuery = defineQuery({
  name: "insights.actions",
  module: "insights",
  schema: InsightIdSchema,
  permission: "insight.read",
  handler: (input, ctx) => listInsightActions(ctx, input.insightId),
});

export const insightsPriorityActionsQuery = defineQuery({
  name: "insights.priorityActions",
  module: "insights",
  schema: z.object({}).strict(),
  permission: "insight.read",
  handler: (_input, ctx) => priorityActions(ctx),
});

export const insightsRiskIndicatorsQuery = defineQuery({
  name: "insights.riskIndicators",
  module: "insights",
  schema: z.object({}).strict(),
  permission: "insight.read",
  handler: (_input, ctx) => riskIndicators(ctx),
});

export const insightsCardsQuery = defineQuery({
  name: "insights.cards",
  module: "insights",
  schema: InsightCardsSchema,
  permission: "insight.read",
  handler: (input, ctx) => insightCards(ctx, input),
});

// M25-T5 — reads the day's persisted brief (no write); null when the
// caller has no brief role or none generated yet (rulings "Writes" / "Frozen").
export const briefingsTodayQuery = defineQuery({
  name: "briefings.today",
  module: "ai_briefings",
  schema: z.object({}).strict(),
  permission: "insight.read",
  handler: (_input, ctx) => readBriefing(ctx),
});
