// M02-T4 — read-only wrapper for ./dashboard.queries.ts, exposed at
// /api/v1/query/core.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handler only adapts
// input -> the existing fn's args: no new logic, no new SQL.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { getDashboardData } from "./dashboard.queries";
import { listAuditEvents } from "./audit.queries";

// permission: dashboard.view — dashboard/page.tsx:124 gates on this before
// calling getDashboardData; also the module default (06 task-3/4 brief).
export const getDashboardDataQuery = defineQuery({
  name: "core.getDashboardData",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: (_input, ctx) => getDashboardData(ctx),
});

// M06-T4 — audit.list query for audit viewer
export const listAuditEventsQuery = defineQuery({
  name: "core.audit.list",
  schema: z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      action: z.string().max(100).optional(),
      entityType: z.string().max(100).optional(),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(100).default(50),
    })
    .strict(),
  permission: "audit.read",
  handler: (input, ctx) =>
    listAuditEvents(ctx, {
      from: input.from,
      to: input.to,
      action: input.action,
      entityType: input.entityType,
      page: input.page,
      pageSize: input.pageSize,
    }),
});
