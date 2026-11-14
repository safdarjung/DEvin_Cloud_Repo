// M02-T4 — read-only wrapper for ./dashboard.queries.ts, exposed at
// /api/v1/query/core.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handler only adapts
// input -> the existing fn's args: no new logic, no new SQL.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { AppError } from "@/lib/actions/result";
import { getDashboardData } from "./dashboard.queries";
import { listAuditEvents } from "./audit.queries";
import { listModules } from "./queries";
import { pendingApprovalsWithStudentLeave } from "./approvals.queries";
import { financeDashboard, admissionsDashboard } from "./dashboard-office.queries";
import { principalDashboard, operationsDashboard } from "./dashboard-leader.queries";
import { teacherDashboard, portalDashboard } from "./dashboard-member.queries";
import { AttendanceTrendSchema, PortalDashboardSchema } from "./dashboard.schemas";
import { attendanceTrend } from "@/modules/attendance/queries";

// permission: dashboard.view — dashboard/page.tsx:124 gates on this before
// calling getDashboardData; also the module default (06 task-3/4 brief).
export const getDashboardDataQuery = defineQuery({
  name: "core.getDashboardData",
  module: "core",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: (_input, ctx) => getDashboardData(ctx),
});

// M06-T4 — audit.list query for audit viewer
export const listAuditEventsQuery = defineQuery({
  name: "core.audit.list",
  module: "core",
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

// MOD-T4 — module catalog + per-institution state, for /settings/modules (T5).
export const listModulesQuery = defineQuery({
  name: "core.modules.list",
  module: "core",
  schema: z.object({}).strict(),
  permission: "institution.settings.manage",
  handler: async (_input, ctx) => listModules(ctx),
});

// M16-T5 — approvals union (demoApprovals replacement). pendingApprovals
// gates each source (leave, recheck) on its own permission + module; this
// query's own gate is just dashboard.view, same as getDashboardData above.
export const pendingApprovalsQuery = defineQuery({
  name: "core.approvals.pending",
  module: "core",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  // With student leave, so an AI answer or briefing counts what the dashboard's "Approvals waiting" tile counts.
  handler: (_input, ctx) => pendingApprovalsWithStudentLeave(ctx),
});

// M16-T8 — dashboard.finance / dashboard.admissions. Each composer gates
// its own fields on finance.read / admissions.enquiry.read + module
// "admissions" (06 rulings "Role dashboards"); this query's own gate is
// just dashboard.view, same as getDashboardData above.
export const financeDashboardQuery = defineQuery({
  name: "dashboard.finance",
  module: "core",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: (_input, ctx) => financeDashboard(ctx),
});

export const admissionsDashboardQuery = defineQuery({
  name: "dashboard.admissions",
  module: "core",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: (_input, ctx) => admissionsDashboard(ctx),
});

// M16-T7 — dashboard.principal / dashboard.operations. Each composer gates
// its own fields on their own permission + module (06 rulings "Role
// dashboards"); this query's own gate is just dashboard.view, same as
// getDashboardData above.
export const principalDashboardQuery = defineQuery({
  name: "dashboard.principal",
  module: "core",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: (_input, ctx) => principalDashboard(ctx),
});

export const operationsDashboardQuery = defineQuery({
  name: "dashboard.operations",
  module: "core",
  schema: z.object({}).strict(),
  permission: "dashboard.view",
  handler: (_input, ctx) => operationsDashboard(ctx),
});

// M16-T4 — demoAttendanceTrend replacement (06 rulings "Trend"). Permission
// is attendance.read, not dashboard.view: this query is also used scoped to
// one student/section outside the dashboard (e.g. the portal).
export const attendanceTrendQuery = defineQuery({
  name: "dashboard.attendanceTrend",
  module: "core",
  schema: AttendanceTrendSchema,
  permission: "attendance.read",
  handler: (input, ctx) => attendanceTrend(ctx, input),
});

// M16-T9 — dashboard.teacher / dashboard.parent / dashboard.student
// (`demoTimetable` + `demoAttendanceTrend` API composite replacement, 06
// rulings "Role dashboards"). Each composer gates its own fields on their
// own permission + module; this query's own gate is the ruling's /today
// gate (attendance.mark) or student.read.
export const teacherDashboardQuery = defineQuery({
  name: "dashboard.teacher",
  module: "core",
  schema: z.object({}).strict(),
  permission: "attendance.mark",
  handler: (_input, ctx) => teacherDashboard(ctx),
});

export const parentDashboardQuery = defineQuery({
  name: "dashboard.parent",
  module: "core",
  schema: PortalDashboardSchema,
  permission: "student.read",
  handler: (input, ctx) => portalDashboard(ctx, input.studentId),
});

// `ctx.membership.studentId` null → forbidden (06 rulings): only the
// caller's own student record, never another student's by id.
export const studentDashboardQuery = defineQuery({
  name: "dashboard.student",
  module: "core",
  schema: z.object({}).strict(),
  permission: "student.read",
  handler: (_input, ctx) => {
    if (!ctx.membership.studentId) throw new AppError("forbidden", "No student record linked to this account.");
    return portalDashboard(ctx, ctx.membership.studentId);
  },
});
