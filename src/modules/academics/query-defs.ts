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
import { mySubmissions, submissionsForAssignment } from "./submissions.queries";

// permission: assignment.read — assignments/page.tsx:21 and
// assignments/[id]/page.tsx:20 gate on this directly.
export const listTeacherAssignmentsQuery = defineQuery({
  name: "academics.listTeacherAssignments",
  module: "assignments",
  schema: z.object({}).strict(),
  permission: "assignment.read",
  handler: (_input, ctx) => listTeacherAssignments(ctx),
});

export const getAssignmentQuery = defineQuery({
  name: "academics.getAssignment",
  module: "assignments",
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
  module: "assignments",
  schema: z.object({ studentId: uuid }).strict(),
  permission: "assignment.read",
  handler: (input, ctx) => listStudentAssignments(ctx, input.studentId),
});

// permission: assignment.read — module default (06 task brief): no page
// calls this fn directly today (grep turned up only this file's own export).
export const listCurriculumUnitsQuery = defineQuery({
  name: "academics.listCurriculumUnits",
  module: "academic_structure",
  schema: z.object({ gradeId: uuid, subjectId: uuid }).strict(),
  permission: "assignment.read",
  handler: (input, ctx) => listCurriculumUnits(ctx, { gradeId: input.gradeId, subjectId: input.subjectId }),
});

// permission: academics.read — sections/subjects are academic structure,
// which 07 §2.2 lets every role read; RLS filters rows and the fn itself
// narrows a teacher to taught sections. Pages gate it on ai.generate or
// assignment.manage, but an API read must not hang off an AI key (M02).
export const listTeachableSectionsQuery = defineQuery({
  name: "academics.listTeachableSections",
  module: "academic_structure",
  schema: z.object({}).strict(),
  permission: "academics.read",
  handler: (_input, ctx) => listTeachableSections(ctx),
});

// permission: academics.read — same reasoning as listTeachableSections.
export const listSectionSubjectsQuery = defineQuery({
  name: "academics.listSectionSubjects",
  module: "academic_structure",
  schema: z.object({ classSectionId: uuid }).strict(),
  permission: "academics.read",
  handler: (input, ctx) => listSectionSubjects(ctx, input.classSectionId),
});

// permission: assignment.read — the grading roster (06 §W6 "Assignments
// awaiting review"); RLS (0071 assignment_submissions_select) narrows a
// teacher to their own taught/class-teacher section.
export const submissionsForAssignmentQuery = defineQuery({
  name: "academics.submissionsForAssignment",
  module: "assignments",
  schema: z.object({ assignmentId: uuid }).strict(),
  permission: "assignment.read",
  handler: (input, ctx) => submissionsForAssignment(ctx, input.assignmentId),
});

// permission: assignment.read — student's own view by default; a guardian
// passes their child's studentId. RLS + mySubmissions' own membership check
// keep a guardian from reading another family's child.
export const mySubmissionsQuery = defineQuery({
  name: "academics.mySubmissions",
  module: "assignments",
  schema: z.object({ studentId: uuid.optional() }).strict(),
  permission: "assignment.read",
  handler: (input, ctx) => mySubmissions(ctx, input.studentId),
});
