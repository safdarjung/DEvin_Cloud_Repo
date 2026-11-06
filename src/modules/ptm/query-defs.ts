// X08-T6 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/ptm.<fn> (mirrors src/modules/timetable/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { PtmEventsQuerySchema, PtmForStudentSchema, PtmScheduleSchema } from "./schemas";
import { ptmEvents, ptmForStudent, ptmTeacherSchedule } from "./queries";

export const ptmEventsQuery = defineQuery({
  name: "ptm.events",
  module: "ptm",
  schema: PtmEventsQuerySchema,
  permission: "ptm.slot.manage",
  handler: (input, ctx) => ptmEvents(ctx, input.includePast),
});

export const ptmTeacherScheduleQuery = defineQuery({
  name: "ptm.teacherSchedule",
  module: "ptm",
  schema: PtmScheduleSchema,
  permission: "ptm.slot.manage",
  handler: (input, ctx) => ptmTeacherSchedule(ctx, input.eventId, input.staffId),
});

export const ptmForStudentQuery = defineQuery({
  name: "ptm.forStudent",
  module: "ptm",
  schema: PtmForStudentSchema,
  permission: "ptm.book",
  handler: (input, ctx) => ptmForStudent(ctx, input.studentId, input.eventId),
});
