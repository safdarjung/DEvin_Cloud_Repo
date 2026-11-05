import "server-only";
// M16-T7 — dashboard.principal + dashboard.operations (06 rulings "Role
// dashboards"). Composers over existing owner reads; no new SQL. A field is
// null when its permission/module is missing (the sub-read never runs).
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { getDashboardData, type DashboardDTO } from "./dashboard.queries";
import { pendingApprovals } from "./approvals.queries";
import type { ApprovalRow } from "@/components/widgets/approvals-widget";
import type { StaffAvailability } from "@/components/widgets/staff-availability-widget";
import { staffAvailabilityToday } from "@/modules/people/hr.queries";
import { attendanceTrend, type TrendPoint } from "@/modules/attendance/queries";
import { timetableCoverNeeded, type CoverNeededRow } from "@/modules/timetable/substitution.queries";
import { facilitiesMaintenanceRequests } from "@/modules/facilities/queries";
import type { MaintenanceRequest } from "@/modules/fabric/types";
import { calendarForRole, type CalendarEventRow } from "@/modules/calendar/queries";

const TREND_DAYS = 42;
const MAINTENANCE_LIMIT = 5;
const EVENTS_LIMIT = 5;

export interface PrincipalDashboard extends DashboardDTO {
  attendanceTrend: TrendPoint[] | null;
  approvals: ApprovalRow[];
  staffToday: StaffAvailability | null;
}

export interface OperationsDashboard {
  staffToday: StaffAvailability | null;
  coverNeeded: CoverNeededRow[] | null;
  openMaintenance: MaintenanceRequest[] | null;
  upcomingEvents: CalendarEventRow[] | null;
}

function canSeeStaffToday(ctx: TenantContext): boolean {
  return ctx.permissions.has("staff.read") && isModuleEnabled(ctx, "staff_attendance");
}

export async function principalDashboard(ctx: TenantContext): Promise<PrincipalDashboard> {
  const canReadAttendance = ctx.permissions.has("attendance.read");
  const canSeeStaff = canSeeStaffToday(ctx);

  const [dto, trend, approvals, staffToday] = await Promise.all([
    getDashboardData(ctx),
    canReadAttendance ? attendanceTrend(ctx, { days: TREND_DAYS }) : Promise.resolve(null),
    pendingApprovals(ctx),
    canSeeStaff ? staffAvailabilityToday(ctx) : Promise.resolve(null),
  ]);

  return { ...dto, attendanceTrend: trend, approvals, staffToday };
}

export async function operationsDashboard(ctx: TenantContext): Promise<OperationsDashboard> {
  const canSeeStaff = canSeeStaffToday(ctx);
  const canSeeCover = ctx.permissions.has("timetable.manage") && isModuleEnabled(ctx, "substitution");
  const canSeeMaintenance = ctx.permissions.has("maintenance.request") && isModuleEnabled(ctx, "facilities");
  const canSeeEvents = ctx.permissions.has("academics.read") && isModuleEnabled(ctx, "calendar");

  const [staffToday, coverRows, openMaintenance, events] = await Promise.all([
    canSeeStaff ? staffAvailabilityToday(ctx) : Promise.resolve(null),
    canSeeCover ? timetableCoverNeeded(ctx) : Promise.resolve(null),
    canSeeMaintenance ? facilitiesMaintenanceRequests(ctx, { status: "open", limit: MAINTENANCE_LIMIT }) : Promise.resolve(null),
    canSeeEvents ? calendarForRole(ctx, {}) : Promise.resolve(null),
  ]);

  const coverNeeded = coverRows ? coverRows.filter((row) => row.substitution === null) : null;
  const upcomingEvents = events ? events.slice(0, EVENTS_LIMIT) : null;

  return { staffToday, coverNeeded, openMaintenance, upcomingEvents };
}
