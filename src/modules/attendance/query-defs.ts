// M02-T4 — read-only wrappers for ./queries.ts, exposed at
// /api/v1/query/attendance.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Handlers only adapt
// input -> the existing fn's positional args: no new logic, no new SQL.
// getAttendanceSettings is skipped — synchronous, no I/O (reads already-
// loaded ctx.institution.settings), same class of helper as T3's skipped
// pure mappers.
import { defineQuery } from "@/lib/actions/define-query";
import { isoDate, uuid } from "@/lib/schemas/common";
import { z } from "zod";
import {
  attendanceTodaySummary,
  getSectionAttendancePatterns,
  getSession,
  getStudentAttendanceSummary,
  getTodaySectionsForTeacher,
  periodSummary,
  sectionsBelowThreshold,
} from "./queries";

// permission: attendance.read — attendance/page.tsx:17 (attendance.read)
// and today/page.tsx:57 (attendance.mark, a subset of attendance.read's
// holders) both reach this fn; attendance.read is the floor every actual
// caller holds.
export const getTodaySectionsForTeacherQuery = defineQuery({
  name: "attendance.getTodaySectionsForTeacher",
  schema: z.object({}).strict(),
  permission: "attendance.read",
  handler: (_input, ctx) => getTodaySectionsForTeacher(ctx),
});

// permission: attendance.mark — attendance/[sectionId]/page.tsx:20 and
// today/page.tsx:57 both gate on attendance.mark before calling this fn.
export const getSessionQuery = defineQuery({
  name: "attendance.getSession",
  schema: z.object({ classSectionId: uuid, date: isoDate }).strict(),
  permission: "attendance.mark",
  handler: (input, ctx) => getSession(ctx, input.classSectionId, input.date),
});

// permission: attendance.read — the domain key (D41: API gates use the
// owning module's key). students/[studentId]/page.tsx renders this widget
// behind only student.read; RLS still filters there (DBT-43).
export const getStudentAttendanceSummaryQuery = defineQuery({
  name: "attendance.getStudentAttendanceSummary",
  schema: z.object({ studentId: uuid, termId: uuid }).strict(),
  permission: "attendance.read",
  handler: (input, ctx) => getStudentAttendanceSummary(ctx, input.studentId, input.termId),
});

// permission: attendance.read — module default; no direct page caller
// (only composed internally by core's getDashboardData).
export const attendanceTodaySummaryQuery = defineQuery({
  name: "attendance.attendanceTodaySummary",
  schema: z.object({}).strict(),
  permission: "attendance.read",
  handler: (_input, ctx) => attendanceTodaySummary(ctx),
});

// permission: attendance.read — same reasoning as attendanceTodaySummary.
export const sectionsBelowThresholdQuery = defineQuery({
  name: "attendance.sectionsBelowThreshold",
  schema: z.object({}).strict(),
  permission: "attendance.read",
  handler: (_input, ctx) => sectionsBelowThreshold(ctx),
});

// permission: attendance.read — 2 call sites: AttendanceInsights component
// (attendance/[sectionId]/page.tsx:20, gates attendance.mark) and the
// teacher-agent tool (teacher-tools.ts, via /api/ai/agent/teacher/route.ts:172
// which gates ai.generate but then hard-restricts to ctx.membership.role
// === "teacher" in code — never gate a data read on ai.generate itself).
// Both actual caller sets (owner/principal/admin/teacher via attendance.mark,
// teacher via the role-restricted AI route) hold attendance.read.
export const getSectionAttendancePatternsQuery = defineQuery({
  name: "attendance.getSectionAttendancePatterns",
  schema: z.object({ classSectionId: uuid, termId: uuid }).strict(),
  permission: "attendance.read",
  handler: (input, ctx) => getSectionAttendancePatterns(ctx, input.classSectionId, input.termId),
});

// permission: attendance.read — M08-T10: the substitution dialog
// (F-UI-05) and the teacher's own period register both read this; RLS on
// attendance_sessions/attendance_records decides which sessions a
// non-admin caller actually sees (DBT-49).
export const periodSummaryQuery = defineQuery({
  name: "attendance.periodSummary",
  schema: z.object({ classSectionId: uuid, date: isoDate }).strict(),
  permission: "attendance.read",
  handler: (input, ctx) => periodSummary(ctx, input.classSectionId, input.date),
});
