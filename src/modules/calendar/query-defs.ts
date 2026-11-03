// M13-T10 — read-only wrapper over ./queries.ts, exposed at
// /api/v1/query/calendar.forRole (mirrors src/modules/timetable/query-defs.ts).
// Gates on academics.read; RLS does the real audience narrowing.
import { defineQuery } from "@/lib/actions/define-query";
import { CalendarForRoleSchema } from "./schemas";
import { calendarForRole } from "./queries";

export const calendarForRoleQuery = defineQuery({
  name: "calendar.forRole",
  module: "calendar",
  schema: CalendarForRoleSchema,
  permission: "academics.read",
  handler: (input, ctx) => calendarForRole(ctx, input),
});
