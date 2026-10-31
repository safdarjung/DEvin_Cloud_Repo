// M02-T3 — read-only wrappers for ./queries.ts, exposed at
// /api/v1/query/people.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS (already applied inside each queries.ts fn via the
// user's own createClient()) stays the actual data filter. Handlers only
// adapt input -> the existing fn's positional args: no new logic, no new SQL.
import { defineQuery } from "@/lib/actions/define-query";
import { uuid } from "@/lib/schemas/common";
import { z } from "zod";
import { getCurrentTermId, getMyStudent, getStudentProfile, listMyChildren, listStudents } from "./queries";

// permission: student.read — the page gate at students/page.tsx (staff list)
// and students/[studentId]/page.tsx (profile); every other caller
// (portal layout, portal pages) sits behind the same student.read floor, and
// student.read is held by every role (07 §2.2), so it's also the module
// default per the task brief.
export const listStudentsQuery = defineQuery({
  name: "people.listStudents",
  schema: z.object({ query: z.string().trim().max(200).optional(), page: z.number().int().positive() }).strict(),
  permission: "student.read",
  handler: (input, ctx) => listStudents(ctx, input.query, input.page),
});

export const getStudentProfileQuery = defineQuery({
  name: "people.getStudentProfile",
  schema: z.object({ studentId: uuid }).strict(),
  permission: "student.read",
  handler: (input, ctx) => getStudentProfile(ctx, input.studentId),
});

// permission: student.read — same reasoning as getStudentProfile/listStudents
// above: of this fn's 4 call sites, 2 (students/[studentId]/page.tsx,
// portal/page.tsx) gate only on student.read, which every role holds, so
// that's the one permission every actual caller is guaranteed to have.
export const getCurrentTermIdQuery = defineQuery({
  name: "people.getCurrentTermId",
  schema: z.object({ academicYearId: uuid }).strict(),
  permission: "student.read",
  handler: (input, ctx) => getCurrentTermId(ctx, input.academicYearId),
});

// permission: student.read — portal/layout.tsx:22 (the only gate on the
// guardian/student portal shell both fns are called from).
export const listMyChildrenQuery = defineQuery({
  name: "people.listMyChildren",
  schema: z.object({}).strict(),
  permission: "student.read",
  handler: (_input, ctx) => listMyChildren(ctx),
});

export const getMyStudentQuery = defineQuery({
  name: "people.getMyStudent",
  schema: z.object({}).strict(),
  permission: "student.read",
  handler: (_input, ctx) => getMyStudent(ctx),
});
