// M02-T6 — read-only wrapper for ./queries.ts, exposed at
// /api/v1/query/ai.<fn>. student-study.queries.ts's notebook reads are out
// of scope (not named in this task's brief). permission: ai.usage.read —
// ai/usage/page.tsx:21's only caller.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { usageByRole, usageSummary } from "./queries";

export const usageSummaryQuery = defineQuery({
  name: "ai.usageSummary",
  module: "core",
  schema: z.object({}).strict(),
  permission: "ai.usage.read",
  handler: (_input, ctx) => usageSummary(ctx),
});

// T3b (ai-roles) — per-role usage/cost for the AI role settings page.
export const usageByRoleQuery = defineQuery({
  name: "ai.usageByRole",
  module: "core",
  schema: z.object({}).strict(),
  permission: "ai.usage.read",
  handler: (_input, ctx) => usageByRole(ctx),
});
