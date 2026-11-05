// M07-T5 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/timetable.<fn> (mirrors src/modules/documents/query-defs.ts).
// forSection/forTeacher/forStudent/todayFor gate on timetable.read (RLS does
// the real narrowing); conflicts/teacherWorkload/roomUtilisation require
// timetable.manage (M07-tasks.md header rulings).
import { z } from "zod";
import { defineQuery } from "@/lib/actions/define-query";
import { uuid } from "@/lib/schemas/common";
import { CoverNeededSchema, ForSectionSchema, ForStudentSchema, ForTeacherSchema, SubstitutionCandidatesSchema, SubstitutionsSchema, VersionQuerySchema } from "./schemas";
import {
  timetableConflicts,
  timetableForSection,
  timetableForStudent,
  timetableForTeacher,
  timetableRoomUtilisation,
  timetableTeacherWorkload,
  timetableTodayFor,
} from "./queries";
import { timetableCoverNeeded, timetableSubstitutionCandidates, timetableSubstitutions } from "./substitution.queries";

export const timetableForSectionQuery = defineQuery({
  name: "timetable.forSection",
  module: "timetable",
  schema: ForSectionSchema,
  permission: "timetable.read",
  handler: (input, ctx) => timetableForSection(ctx, input.classSectionId, input.versionId),
});

export const timetableForTeacherQuery = defineQuery({
  name: "timetable.forTeacher",
  module: "timetable",
  schema: ForTeacherSchema,
  permission: "timetable.read",
  handler: (input, ctx) => timetableForTeacher(ctx, input.staffId, input.versionId),
});

export const timetableForStudentQuery = defineQuery({
  name: "timetable.forStudent",
  module: "timetable",
  schema: ForStudentSchema,
  permission: "timetable.read",
  handler: (input, ctx) => timetableForStudent(ctx, input.studentId),
});

export const timetableTodayForQuery = defineQuery({
  name: "timetable.todayFor",
  module: "timetable",
  schema: z.object({ studentId: uuid.optional() }).strict(),
  permission: "timetable.read",
  handler: (input, ctx) => timetableTodayFor(ctx, input.studentId),
});

export const timetableConflictsQuery = defineQuery({
  name: "timetable.conflicts",
  module: "timetable",
  schema: VersionQuerySchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableConflicts(ctx, input.versionId),
});

export const timetableTeacherWorkloadQuery = defineQuery({
  name: "timetable.teacherWorkload",
  module: "timetable",
  schema: VersionQuerySchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableTeacherWorkload(ctx, input.versionId),
});

export const timetableRoomUtilisationQuery = defineQuery({
  name: "timetable.roomUtilisation",
  module: "timetable",
  schema: VersionQuerySchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableRoomUtilisation(ctx, input.versionId),
});

// M08-T12: timetable.coverNeeded / substitutionCandidates / substitutions
export const timetableCoverNeededQuery = defineQuery({
  name: "timetable.coverNeeded",
  module: "substitution",
  schema: CoverNeededSchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableCoverNeeded(ctx, input.date),
});

export const timetableSubstitutionCandidatesQuery = defineQuery({
  name: "timetable.substitutionCandidates",
  module: "substitution",
  schema: SubstitutionCandidatesSchema,
  permission: "timetable.manage",
  handler: (input, ctx) => timetableSubstitutionCandidates(ctx, input.slotId, input.date),
});

export const timetableSubstitutionsQuery = defineQuery({
  name: "timetable.substitutions",
  module: "substitution",
  schema: SubstitutionsSchema,
  permission: "timetable.read",
  handler: (input, ctx) => timetableSubstitutions(ctx, input.date),
});
