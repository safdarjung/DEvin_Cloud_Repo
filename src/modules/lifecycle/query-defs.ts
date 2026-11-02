// M14-T8 — read-only wrapper over ./queries.ts, exposed at
// /api/v1/query/lifecycle.history (query-def style mirrors
// src/modules/timetable/query-defs.ts). LANE B: no `module` field (MOD not
// in this tree — M14-tasks.md header ruling).
import { defineQuery } from "@/lib/actions/define-query";
import { HistorySchema } from "./schemas";
import { lifecycleHistory } from "./queries";

export const lifecycleHistoryQuery = defineQuery({
  name: "lifecycle.history",
  schema: HistorySchema,
  permission: "student.read",
  handler: (input, ctx) => lifecycleHistory(ctx, input.studentId),
});
