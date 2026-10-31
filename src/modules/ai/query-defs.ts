// M02-T6 — read-only wrapper for ./queries.ts, exposed at
// /api/v1/query/ai.<fn>. student-study.queries.ts's notebook reads are out
// of scope (not named in this task's brief). permission: ai.usage.read —
// ai/usage/page.tsx:21's only caller.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { usageSummary } from "./queries";

export const usageSummaryQuery = defineQuery({
  name: "ai.usageSummary",
  schema: z.object({}).strict(),
  permission: "ai.usage.read",
  handler: (_input, ctx) => usageSummary(ctx),
});
