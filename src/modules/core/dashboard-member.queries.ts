import "server-only";
// M16-T9 — dashboard.teacher / dashboard.parent / dashboard.student (06
// rulings "Role dashboards"). Composers over existing owner reads, no new
// SQL. A field is null when its permission/module is missing (the
// sub-read never runs); `[]`/`0` means allowed but no data.
import type { TenantContext } from "@/lib/auth/types";
import { AppError } from "@/lib/actions/result";
import { isModuleEnabled } from "@/lib/modules/catalog";
import type { TimetablePeriod } from "@/components/widgets/timetable-widget";
import { timetableTodayFor } from "@/modules/timetable/queries";
import {
  attendanceTrend,
  getStudentAttendanceSummary,
  getTodaySectionsForTeacher,
  type SectionOption,
  type StudentAttendanceSummary,
  type TrendPoint,
} from "@/modules/attendance/queries";
import { getCurrentTermId, getStudentProfile } from "@/modules/people/queries";
import { getMyPapers, listResultsForStudent, type StudentResultRow } from "@/modules/exams/queries";
import {
  listStudentAssignments,
  listTeacherAssignments,
  type AssignmentSummary,
} from "@/modules/academics/assignments.queries";
import { listInvoicesForStudent, moneyToPaise, paiseToMoney } from "@/modules/finance/queries";

export interface TeacherDashboard {
  timetable: TimetablePeriod[] | null;
  sectionsToday: SectionOption[];
  papersToMark: number | null;
  activeAssignments: number | null;
}

/** dashboard.teacher — `demoTimetable` (API composite) replacement for the teacher-facing dashboard. */
export async function teacherDashboard(ctx: TenantContext): Promise<TeacherDashboard> {
  const canMarkExams = ctx.permissions.has("exam.marks.enter") && isModuleEnabled(ctx, "exams");
  const canReadAssignments = ctx.permissions.has("assignment.read") && isModuleEnabled(ctx, "assignments");

  const [timetable, sectionsToday, papersToMark, activeAssignments] = await Promise.all([
    isModuleEnabled(ctx, "timetable") ? timetableTodayFor(ctx) : Promise.resolve(null),
    getTodaySectionsForTeacher(ctx),
    canMarkExams ? getMyPapers(ctx).then((papers) => papers.length) : Promise.resolve(null),
    canReadAssignments
      ? listTeacherAssignments(ctx).then((rows) => rows.filter((row) => row.status !== "closed").length)
      : Promise.resolve(null),
  ]);

  return { timetable, sectionsToday, papersToMark, activeAssignments };
}

const PORTAL_TREND_DAYS = 30;
const UPCOMING_ASSIGNMENTS_LIMIT = 5;
// Balance-bearing statuses (listDefaulters precedent, finance/queries.ts) — paid/cancelled invoices have no outstanding balance.
const UNPAID_INVOICE_STATUSES = new Set(["issued", "part_paid"]);

export interface PortalDashboard {
  studentId: string;
  timetable: TimetablePeriod[] | null;
  attendanceTrend: TrendPoint[];
  attendance: StudentAttendanceSummary | null;
  outstandingFees: number;
  latestResult: StudentResultRow | null;
  upcomingAssignments: AssignmentSummary[] | null;
}

/**
 * dashboard.parent / dashboard.student — `demoTimetable` + `demoAttendanceTrend`
 * (API composite) replacement for the guardian/student portal dashboard.
 * `getStudentProfile` returning null is the BOLA guard (06 M16 rulings):
 * never an empty `ok` dashboard for another family's child.
 */
export async function portalDashboard(ctx: TenantContext, studentId: string): Promise<PortalDashboard> {
  const profile = await getStudentProfile(ctx, studentId);
  if (!profile) throw new AppError("not_found", "Student not found.");

  const nowMs = Date.now();
  const canReadExams = isModuleEnabled(ctx, "exams");
  const canReadAssignments = isModuleEnabled(ctx, "assignments");

  // M16 security review (LOW): timetable/attendanceTrend/attendance/invoices
  // below have no extra permission check here beyond this function's own
  // `student.read` gate (via `getStudentProfile`'s BOLA guard above) — unlike
  // latestResult/upcomingAssignments, which do check an extra module. That is
  // deliberately correct, not an oversight: downstream RLS independently
  // scopes each read (finance_roles() on invoices, the attendance role lists
  // on attendanceTrend/attendance, the timetable_slots policy on timetable),
  // so a role like admissions/accountant that reaches this composer still
  // sees nothing for data it has no business right to (verified: finance RLS
  // blocks admissions). If RLS on any of those tables, or this composer's own
  // shape, ever changes, re-check that this reliance still holds.
  const [timetable, attendanceTrendPoints, attendance, invoices, latestResult, upcomingAssignments] = await Promise.all([
    isModuleEnabled(ctx, "timetable") ? timetableTodayFor(ctx, studentId) : Promise.resolve(null),
    attendanceTrend(ctx, { days: PORTAL_TREND_DAYS, studentId }),
    profile.enrolment
      ? getCurrentTermId(ctx, profile.enrolment.academicYearId).then((termId) =>
          termId ? getStudentAttendanceSummary(ctx, studentId, termId) : null,
        )
      : Promise.resolve(null),
    listInvoicesForStudent(ctx, studentId),
    canReadExams ? listResultsForStudent(ctx, studentId).then((rows) => rows[0] ?? null) : Promise.resolve(null),
    canReadAssignments
      ? listStudentAssignments(ctx, studentId).then((rows) =>
          rows
            .filter((row) => row.dueAt !== null && new Date(row.dueAt).getTime() >= nowMs)
            .slice(0, UPCOMING_ASSIGNMENTS_LIMIT),
        )
      : Promise.resolve(null),
  ]);

  // Money-float fix (lesson 8): subtract/sum in integer paise, not floats.
  const outstandingPaise = invoices
    .filter((invoice) => UNPAID_INVOICE_STATUSES.has(invoice.status))
    .reduce((sum, invoice) => sum + (moneyToPaise(invoice.total) - moneyToPaise(invoice.paidTotal)), 0);

  return {
    studentId,
    timetable,
    attendanceTrend: attendanceTrendPoints,
    attendance,
    outstandingFees: paiseToMoney(outstandingPaise),
    latestResult,
    upcomingAssignments,
  };
}
