// X01-T7 — studentLeave.list, exposed at /api/v1/query/studentLeave.list
// (mirrors src/modules/diary/query-defs.ts). Reuses attendance.read per
// rulings; RLS does the real narrowing.
import { defineQuery } from "@/lib/actions/define-query";
import { StudentLeaveListSchema } from "./schemas.ts";
import { studentLeaveRequests } from "./queries";

export const studentLeaveListQuery = defineQuery({
  name: "studentLeave.list",
  module: "student_leave",
  schema: StudentLeaveListSchema,
  permission: "attendance.read",
  handler: (input, ctx) => studentLeaveRequests(ctx, input),
});
