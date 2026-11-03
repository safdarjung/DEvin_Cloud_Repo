// M08-T11 — read-only wrappers over ./hr.queries.ts, exposed at
// /api/v1/query/people.<fn> (mirrors src/modules/timetable/query-defs.ts).
import { z } from "zod";
import { defineQuery } from "@/lib/actions/define-query";
import { LeaveListSchema, StaffAttendanceForDateSchema } from "./hr.schemas";
import { leaveRequests, pendingLeaveApprovals, staffAttendanceForDate, staffAvailabilityToday } from "./hr.queries";

export const staffAvailabilityTodayQuery = defineQuery({
  name: "people.staffAvailabilityToday",
  module: "staff_attendance",
  schema: z.object({}).strict(),
  permission: "staff.read",
  handler: (_input, ctx) => staffAvailabilityToday(ctx),
});

export const pendingLeaveApprovalsQuery = defineQuery({
  name: "people.pendingLeaveApprovals",
  module: "staff_attendance",
  schema: z.object({}).strict(),
  permission: "leave.approve",
  handler: (_input, ctx) => pendingLeaveApprovals(ctx),
});

export const leaveRequestsQuery = defineQuery({
  name: "people.leaveRequests",
  module: "staff_attendance",
  schema: LeaveListSchema,
  permission: "leave.request",
  handler: (input, ctx) => leaveRequests(ctx, input),
});

export const staffAttendanceForDateQuery = defineQuery({
  name: "people.staffAttendanceForDate",
  module: "staff_attendance",
  schema: StaffAttendanceForDateSchema,
  permission: "staff.attendance.mark",
  handler: (input, ctx) => staffAttendanceForDate(ctx, input.date),
});
