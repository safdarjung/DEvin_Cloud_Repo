// X01-T9 — diary.* reads, exposed at /api/v1/query/diary.<fn> (mirrors
// src/modules/timetable/query-defs.ts). forSection/forStudent gate on
// assignment.read (RLS does the real narrowing); ackStatus requires
// diary.write per rulings.
import { defineQuery } from "@/lib/actions/define-query";
import { DiaryAckStatusSchema, DiaryForSectionSchema, DiaryForStudentSchema } from "./schemas.ts";
import { diaryAckStatus, diaryForSection, diaryForStudent } from "./queries";

export const diaryForSectionQuery = defineQuery({
  name: "diary.forSection",
  module: "diary",
  schema: DiaryForSectionSchema,
  permission: "assignment.read",
  handler: (input, ctx) => diaryForSection(ctx, input.classSectionId, input.from, input.to),
});

export const diaryForStudentQuery = defineQuery({
  name: "diary.forStudent",
  module: "diary",
  schema: DiaryForStudentSchema,
  permission: "assignment.read",
  handler: (input, ctx) => diaryForStudent(ctx, input.studentId, input.from, input.to),
});

export const diaryAckStatusQuery = defineQuery({
  name: "diary.ackStatus",
  module: "diary",
  schema: DiaryAckStatusSchema,
  permission: "diary.write",
  handler: (input, ctx) => diaryAckStatus(ctx, input.entryId),
});
