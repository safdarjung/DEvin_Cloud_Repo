// M15-T11 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/report.<fn> (pattern mirrors src/modules/timetable/query-defs.ts).
// report.export's permission check is fixed at data.export here; the
// source's own permission (attendance.read / finance.read) is checked
// inside reportExport, per rulings.
import { defineQuery } from "@/lib/actions/define-query";
import { ReportExportSchema, ReportListSchema, ReportRunsSchema } from "./schemas";
import { reportExport, reportList, reportRuns } from "./queries";

export const reportListQuery = defineQuery({
  name: "report.list",
  module: "scheduled_reports",
  schema: ReportListSchema,
  permission: "report.schedule",
  handler: (_input, ctx) => reportList(ctx),
});

export const reportRunsQuery = defineQuery({
  name: "report.runs",
  module: "scheduled_reports",
  schema: ReportRunsSchema,
  permission: "document.read",
  handler: (input, ctx) => reportRuns(ctx, input.reportId, input.limit),
});

export const reportExportQuery = defineQuery({
  name: "report.export",
  module: "scheduled_reports",
  schema: ReportExportSchema,
  permission: "data.export",
  handler: (input, ctx) => reportExport(ctx, input),
});
