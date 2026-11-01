// M07-T5 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/timetable.<fn> (mirrors src/modules/documents/query-defs.ts).
// forSection/forTeacher/forStudent/todayFor gate on timetable.read (RLS does
// the real narrowing); conflicts/teacherWorkload/roomUtilisation require
// timetable.manage (M07-tasks.md header rulings).
import { z } from "zod";
import { defineQuery } from "@/lib/actions/define-query";
import { ForSectionSchema, ForStudentSchema, ForTeacherSchema, VersionQuerySchema } from "./schemas";
import {
  timetableConflicts,
  timetableForSection,
  timetableForStudent,
  timetableForTeacher,
  timetableRoomUtilisation,
  timetableTeacherWorkload,
  timetableTodayFor,
} from "./queries";

export const timetableForSectionQuery = defineQuery({
  name: "timetable.forSection",
  schema: ForSectionSchema,
  permission: "timetable.read",
  handler: (input, ctx) => timetableForSection(ctx, input.classSectionId, input.versionId),
});

export const timetableForTeacherQuery = defineQuery({
  name: "timetable.forTeacher",
  schema: ForTeacherSchema,
  permission: "timetable.read",
  handler: (input, ctx) => timetableForTeacher(ctx, input.staffId, input.versionId),
});

export const timetableForStudentQuery = defineQuery({
  name: "timetable.forStudent",
  schema: ForStudentSchema,
  permission: "timetable.read",
  handler: (input, ctx) => timetableForStudent(ctx, input.studentId),
});

export const timetableTodayForQuery = defineQuery({
  name: "timetable.todayFor",
  schema: z.object({}).strict(),
  permission: "timetable.read",
  handler: (_input, ctx) => timetableTodayFor(ctx),
});

export const timetableConflictsQuery = defineQuery({
  name: "timetable.conflicts",
  schema: VersionQuerySchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableConflicts(ctx, input.versionId),
});

export const timetableTeacherWorkloadQuery = defineQuery({
  name: "timetable.teacherWorkload",
  schema: VersionQuerySchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableTeacherWorkload(ctx, input.versionId),
});

export const timetableRoomUtilisationQuery = defineQuery({
  name: "timetable.roomUtilisation",
  schema: VersionQuerySchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableRoomUtilisation(ctx, input.versionId),
});
