// M02-T3 — read-only wrappers for ./assignments.queries.ts, exposed at
// /api/v1/query/academics.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handlers only adapt
// input -> the existing fn's positional args: no new logic, no new SQL.
// listGuardianChildren is skipped — already internal-only (06 brief: a
// guardian's own ids for the /assignments page, not a page-level read in
// its own right).
import { defineQuery } from "@/lib/actions/define-query";
import { uuid } from "@/lib/schemas/common";
import { z } from "zod";
import {
  getAssignment,
  listCurriculumUnits,
  listSectionSubjects,
  listStudentAssignments,
  listTeachableSections,
  listTeacherAssignments,
} from "./assignments.queries";

// permission: assignment.read — assignments/page.tsx:21 and
// assignments/[id]/page.tsx:20 gate on this directly.
export const listTeacherAssignmentsQuery = defineQuery({
  name: "academics.listTeacherAssignments",
  schema: z.object({}).strict(),
  permission: "assignment.read",
  handler: (_input, ctx) => listTeacherAssignments(ctx),
});

export const getAssignmentQuery = defineQuery({
  name: "academics.getAssignment",
  schema: z.object({ assignmentId: uuid }).strict(),
  permission: "assignment.read",
  handler: (input, ctx) => getAssignment(ctx, input.assignmentId),
});

// permission: assignment.read — assignments/page.tsx:21 (staff) and
// portal/assignments/page.tsx:18 / portal/page.tsx:78 (guardian/student)
// all gate on this; held by every role that calls it (owner/principal/
// admin/teacher/student/guardian).
export const listStudentAssignmentsQuery = defineQuery({
  name: "academics.listStudentAssignments",
  schema: z.object({ studentId: uuid }).strict(),
  permission: "assignment.read",
  handler: (input, ctx) => listStudentAssignments(ctx, input.studentId),
});

// permission: assignment.read — module default (06 task brief): no page
// calls this fn directly today (grep turned up only this file's own export).
export const listCurriculumUnitsQuery = defineQuery({
  name: "academics.listCurriculumUnits",
  schema: z.object({ gradeId: uuid, subjectId: uuid }).strict(),
  permission: "assignment.read",
  handler: (input, ctx) => listCurriculumUnits(ctx, { gradeId: input.gradeId, subjectId: input.subjectId }),
});

// permission: ai.generate — this fn has 3 call sites with 2 different
// gates: ai/page.tsx:22 and assignments/units/[unitId]/page.tsx:18 (both
// ai.generate), assignments/new/page.tsx:15 (assignment.manage). The
// module default (assignment.read) and assignment.manage both fail here —
// neither is held by the admissions role, which reaches this fn via
// ai/page.tsx's ai.generate gate. ai.generate IS held by every role that
// can reach any of the 3 call sites (owner/principal/admin/admissions/
// teacher — assignment.manage's holders are a subset of these).
export const listTeachableSectionsQuery = defineQuery({
  name: "academics.listTeachableSections",
  schema: z.object({}).strict(),
  permission: "academics.read",
  handler: (_input, ctx) => listTeachableSections(ctx),
});

// permission: ai.generate — same 3 call sites and reasoning as
// listTeachableSections above (assignments/new + assignments/units both
// call this right after listTeachableSections).
export const listSectionSubjectsQuery = defineQuery({
  name: "academics.listSectionSubjects",
  schema: z.object({ classSectionId: uuid }).strict(),
  permission: "academics.read",
  handler: (input, ctx) => listSectionSubjects(ctx, input.classSectionId),
});
