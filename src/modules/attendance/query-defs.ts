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
import { attendanceTodayBySection } from "./command.queries";
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { getStudentProfile, termIdOrCurrent, WHOLE_SCHOOL_ROLES } from "@/modules/people/queries";

/** No termId: the current term (an unknown term used to answer "0% attendance"). */
async function requireTerm(ctx: TenantContext, termId?: string): Promise<string> {
  const id = await termIdOrCurrent(ctx, termId);
  if (!id) throw new AppError("not_found", "No term is set up for the current academic year.");
  return id;
}

// permission: attendance.read — attendance/page.tsx:17 (attendance.read)
// and today/page.tsx:57 (attendance.mark, a subset of attendance.read's
// holders) both reach this fn; attendance.read is the floor every actual
// caller holds.
export const getTodaySectionsForTeacherQuery = defineQuery({
  name: "attendance.getTodaySectionsForTeacher",
  module: "attendance",
  schema: z.object({}).strict(),
  permission: "attendance.read",
  handler: (_input, ctx) => getTodaySectionsForTeacher(ctx),
});

// permission: attendance.mark — attendance/[sectionId]/page.tsx:20 and
// today/page.tsx:57 both gate on attendance.mark before calling this fn.
export const getSessionQuery = defineQuery({
  name: "attendance.getSession",
  module: "attendance",
  schema: z.object({ classSectionId: uuid, date: isoDate }).strict(),
  permission: "attendance.mark",
  handler: (input, ctx) => getSession(ctx, input.classSectionId, input.date),
});

// permission: attendance.read — the domain key (D41: API gates use the
// owning module's key). students/[studentId]/page.tsx renders this widget
// behind only student.read; RLS still filters there (DBT-43).
export const getStudentAttendanceSummaryQuery = defineQuery({
  name: "attendance.getStudentAttendanceSummary",
  module: "attendance",
  schema: z.object({ studentId: uuid, termId: uuid.optional() }).strict(),
  permission: "attendance.read",
  handler: async (input, ctx) => {
    // RLS hides another class's records, which read as "0%": a student the caller cannot see is not_found.
    if (!(await getStudentProfile(ctx, input.studentId))) throw new AppError("not_found", "Student not found.");
    const summary = await getStudentAttendanceSummary(ctx, input.studentId, await requireTerm(ctx, input.termId));
    // No marked days is "none yet", not 0%.
    return { ...summary, percentage: summary.totalInDenominator > 0 ? summary.percentage : null };
  },
});

// permission: attendance.read — module default; no direct page caller
// (only composed internally by core's getDashboardData).
export const attendanceTodaySummaryQuery = defineQuery({
  name: "attendance.attendanceTodaySummary",
  module: "attendance",
  schema: z.object({}).strict(),
  permission: "attendance.read",
  handler: async (_input, ctx) => {
    const summary = await attendanceTodaySummary(ctx);
    return {
      ...summary,
      // Nothing marked yet is "none", not 0%.
      percentage: summary.studentsMarked > 0 ? summary.percentage : null,
      // RLS narrows a teacher to their own classes: say so, as todayBySection does.
      scope: WHOLE_SCHOOL_ROLES.includes(ctx.membership.role) ? "whole school" : "only your own classes. Other classes are hidden from you, not zero. Say that.",
    };
  },
});

// Today, class by class (whole students per status) and the classes not marked yet. RLS limits the
// sections a teacher sees; counts only, no names.
export const attendanceTodayBySectionQuery = defineQuery({
  name: "attendance.todayBySection",
  module: "attendance",
  // date: another day (YYYY-MM-DD), e.g. "was attendance taken yesterday in 8A?". Default today.
  schema: z.object({ date: isoDate.optional() }).strict(),
  permission: "attendance.read",
  handler: (input, ctx) => attendanceTodayBySection(ctx, input.date),
});

// permission: attendance.read — same reasoning as attendanceTodaySummary.
export const sectionsBelowThresholdQuery = defineQuery({
  name: "attendance.sectionsBelowThreshold",
  module: "attendance",
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
  module: "attendance",
  schema: z.object({ classSectionId: uuid, termId: uuid.optional() }).strict(),
  permission: "attendance.read",
  handler: async (input, ctx) => getSectionAttendancePatterns(ctx, input.classSectionId, await requireTerm(ctx, input.termId)),
});

// permission: attendance.read — M08-T10: the substitution dialog
// (F-UI-05) and the teacher's own period register both read this; RLS on
// attendance_sessions/attendance_records decides which sessions a
// non-admin caller actually sees (DBT-49).
export const periodSummaryQuery = defineQuery({
  name: "attendance.periodSummary",
  module: "timetable",
  schema: z.object({ classSectionId: uuid, date: isoDate }).strict(),
  permission: "attendance.read",
  handler: (input, ctx) => periodSummary(ctx, input.classSectionId, input.date),
});
