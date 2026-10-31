// M02-T4 — read-only wrapper for ./dashboard.queries.ts, exposed at
// /api/v1/query/core.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handler only adapts
// input -> the existing fn's args: no new logic, no new SQL.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { getDashboardData } from "./dashboard.queries";

// permission: dashboard.view — dashboard/page.tsx:124 gates on this before
// calling getDashboardData; also the module default (06 task-3/4 brief).
export const getDashboardDataQuery = defineQuery({
  name: "core.getDashboardData",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: (_input, ctx) => getDashboardData(ctx),
});
