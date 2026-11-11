// M02-T6 — read-only wrapper for ./queries.ts, exposed at
// /api/v1/query/ai.<fn>. student-study.queries.ts's notebook reads are out
// of scope (not named in this task's brief). permission: ai.usage.read —
// ai/usage/page.tsx:21's only caller.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { getAskAiNudges } from "./nudges.queries";
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

// Ask AI orb nudges. notification.read is held by every role; each source inside re-checks its own permission and module.
export const askNudgesQuery = defineQuery({
  name: "ai.askNudges",
  module: "core",
  schema: z.object({}).strict(),
  permission: "notification.read",
  handler: (_input, ctx) => getAskAiNudges(ctx),
});

// Orb task bridge (design §1): picker options for one task field, read through the owning module's queries under the caller's RLS.
export const taskEntityOptionsQuery = defineQuery({
  name: "ai.taskEntityOptions",
  module: "core",
  schema: z
    .object({
      action: z.string().min(1).max(120),
      path: z.string().min(1).max(200),
      entity: z.string().min(1).max(60),
      search: z.string().max(100).optional(),
      scope: z.record(z.string().max(60), z.string().max(100)).optional(),
    })
    .strict(),
  permission: "ai.chat",
  handler: async (input, ctx) => (await import("./tasks/entity-options")).taskEntityOptions(ctx, input),
});
