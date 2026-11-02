import "server-only";
// M08-T11 — HR queries: the demoStaffAvailability/demoApprovals
// (src/modules/core/demo/fixtures.ts) replacement + leave/staff-attendance
// reads. Always the signed-in user's RLS client (CLAUDE.md); RLS (0070)
// already narrows leave_requests/staff_attendance to approver-all or
// own-row, the filters below are defense in depth, same shape as every
// other queries.ts. "Today" = todayInInstitutionTimezone (attendance/
// queries.ts, exported for this file per rulings).
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "@/lib/auth/types";
import type { ApprovalRow } from "@/components/widgets/approvals-widget";
import type { StaffAvailability } from "@/components/widgets/staff-availability-widget";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import type { LeaveListInput } from "./hr.schemas";

const ADMIN_ROLES = new Set(["owner", "principal", "admin"]);
const MAX_ON_LEAVE_SHOWN = 10;
const DEFAULT_LEAVE_LIMIT = 50;

function isAdminRole(ctx: TenantContext): boolean {
  return ADMIN_ROLES.has(ctx.membership.role);
}

/** Approved leave_requests rows covering `date`, institution-scoped. */
async function approvedLeaveRowsCoveringDate(
  supabase: SupabaseClient,
  institutionId: string,
  date: string,
): Promise<{ staff_id: string; end_date: string }[]> {
  const { data, error } = await supabase
    .from("leave_requests")
    .select("staff_id, end_date")
    .eq("institution_id", institutionId)
    .eq("status", "approved")
    .lte("start_date", date)
    .gte("end_date", date);
  if (error) throw error;
  return data ?? [];
}

/**
 * Per-staff unavailability on `date`: "leave" (approved leave covers it,
 * checked first) else "absent" (marked absent that day). Unmarked/present
 * staff are absent from the map. Plain export, no registration — cross-
 * module helper per rulings §Queries.
 */
export async function staffUnavailableOn(ctx: TenantContext, date: string): Promise<Map<string, "leave" | "absent">> {
  const supabase = await createClient();
  const result = new Map<string, "leave" | "absent">();
  const leaveRows = await approvedLeaveRowsCoveringDate(supabase, ctx.institution.id, date);
  for (const row of leaveRows) result.set(row.staff_id, "leave");

  const { data: absentRows, error } = await supabase
    .from("staff_attendance")
    .select("staff_id")
    .eq("institution_id", ctx.institution.id)
    .eq("date", date)
    .eq("status", "absent");
  if (error) throw error;
  for (const row of absentRows ?? []) {
    if (!result.has(row.staff_id)) result.set(row.staff_id, "absent");
  }
  return result;
}

function expandDateRange(fromIso: string, toIso: string): string[] {
  const dates: string[] = [];
  let cursor = Date.parse(`${fromIso}T00:00:00Z`);
  const end = Date.parse(`${toIso}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return dates;
}

/**
 * Each staff member's approved-leave dates inside [fromIso, toIso],
 * ascending. Leave ranges per staff never overlap (guard trigger), so
 * concatenating per-row expansions and sorting is safe. Plain export, no
 * registration — cross-module helper per rulings §Queries.
 */
export async function approvedLeaveDates(
  ctx: TenantContext,
  staffIds: string[],
  fromIso: string,
  toIso: string,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (staffIds.length === 0) return result;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leave_requests")
    .select("staff_id, start_date, end_date")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "approved")
    .in("staff_id", staffIds)
    .lte("start_date", toIso)
    .gte("end_date", fromIso);
  if (error) throw error;
  for (const row of data ?? []) {
    const dates = expandDateRange(row.start_date < fromIso ? fromIso : row.start_date, row.end_date > toIso ? toIso : row.end_date);
    result.set(row.staff_id, [...(result.get(row.staff_id) ?? []), ...dates].sort());
  }
  return result;
}

/** demoStaffAvailability replacement (core/demo/fixtures.ts). */
export async function staffAvailabilityToday(ctx: TenantContext): Promise<StaffAvailability> {
  const supabase = await createClient();
  const today = todayInInstitutionTimezone(ctx);

  const { data: staffRows, error: staffErr } = await supabase
    .from("staff")
    .select("id, full_name, designation")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active");
  if (staffErr) throw staffErr;
  if (!staffRows || staffRows.length === 0) return { present: 0, onLeave: 0, absent: 0, onLeaveStaff: [] };

  const unavailable = await staffUnavailableOn(ctx, today);
  const leaveRows = await approvedLeaveRowsCoveringDate(supabase, ctx.institution.id, today);
  const endDateByStaff = new Map(leaveRows.map((r) => [r.staff_id, r.end_date]));

  const { data: attRows, error: attErr } = await supabase
    .from("staff_attendance")
    .select("staff_id, status")
    .eq("institution_id", ctx.institution.id)
    .eq("date", today);
  if (attErr) throw attErr;

  let present = 0;
  let absent = 0;
  let onLeave = 0;
  for (const s of staffRows) {
    const state = unavailable.get(s.id);
    if (state === "leave") onLeave++;
    else if (state === "absent") absent++;
  }
  const activeIds = new Set(staffRows.map((s) => s.id));
  for (const row of attRows ?? []) {
    if (!activeIds.has(row.staff_id) || unavailable.has(row.staff_id)) continue;
    if (row.status === "present" || row.status === "late" || row.status === "half_day") present++;
  }

  const todayMs = Date.parse(`${today}T00:00:00Z`);
  const onLeaveStaff = staffRows
    .filter((s) => unavailable.get(s.id) === "leave")
    .map((s) => {
      const endDate = endDateByStaff.get(s.id) ?? today;
      const days = Math.round((Date.parse(`${endDate}T00:00:00Z`) - todayMs) / 86_400_000) + 1;
      return { name: s.full_name, role: s.designation, until: days <= 1 ? "Back tomorrow" : `Back in ${days} days`, endDate };
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate) || a.name.localeCompare(b.name))
    .slice(0, MAX_ON_LEAVE_SHOWN)
    .map((s) => ({ name: s.name, role: s.role, until: s.until }));

  return { present, onLeave, absent, onLeaveStaff };
}

function daysBetweenInclusive(startDate: string, endDate: string): number {
  return Math.round((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
}

function ageLabel(createdAt: string): string {
  const hours = Math.round((Date.now() - Date.parse(createdAt)) / 3_600_000);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/** demoApprovals leave-rows replacement (core/demo/fixtures.ts). Oldest first, no href. */
export async function pendingLeaveApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leave_requests")
    .select("id, leave_type, start_date, end_date, created_at, staff:staff_id(full_name)")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const days = daysBetweenInclusive(row.start_date, row.end_date);
    const typeLabel = row.leave_type.charAt(0).toUpperCase() + row.leave_type.slice(1);
    const staff = row.staff as { full_name: string } | null;
    return {
      id: row.id,
      kind: "leave",
      title: `${typeLabel} leave, ${days} day${days === 1 ? "" : "s"}`,
      requestedBy: staff?.full_name ?? "Unknown",
      age: ageLabel(row.created_at),
    };
  });
}

export interface LeaveRequestRow {
  id: string;
  staffId: string;
  staffName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

/** RLS (0070): approvers see all of the institution, staff see only their own. */
export async function leaveRequests(ctx: TenantContext, input: LeaveListInput): Promise<LeaveRequestRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("leave_requests")
    .select("id, staff_id, leave_type, start_date, end_date, reason, status, decided_at, decision_note, created_at, staff:staff_id(full_name)")
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(input.limit ?? DEFAULT_LEAVE_LIMIT);
  if (input.status) query = query.eq("status", input.status);
  if (input.staffId) query = query.eq("staff_id", input.staffId);
  if (input.from) query = query.gte("end_date", input.from);
  if (input.to) query = query.lte("start_date", input.to);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const staff = row.staff as { full_name: string } | null;
    return {
      id: row.id,
      staffId: row.staff_id,
      staffName: staff?.full_name ?? "Unknown",
      leaveType: row.leave_type,
      startDate: row.start_date,
      endDate: row.end_date,
      days: daysBetweenInclusive(row.start_date, row.end_date),
      reason: row.reason,
      status: row.status,
      decidedAt: row.decided_at,
      decisionNote: row.decision_note,
      createdAt: row.created_at,
    };
  });
}

export interface StaffAttendanceForDateRow {
  staffId: string;
  name: string;
  designation: string;
  status: string | null;
  source: string | null;
  checkInAt: string | null;
  onLeave: boolean;
}

/** Admin roles get every active staff member; others get only their own row. */
export async function staffAttendanceForDate(ctx: TenantContext, date: string | undefined): Promise<StaffAttendanceForDateRow[]> {
  const supabase = await createClient();
  const targetDate = date ?? todayInInstitutionTimezone(ctx);

  let staffQuery = supabase
    .from("staff")
    .select("id, full_name, designation")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "active")
    .order("full_name");
  if (!isAdminRole(ctx)) {
    if (!ctx.membership.staffId) return [];
    staffQuery = staffQuery.eq("id", ctx.membership.staffId);
  }
  const { data: staffRows, error: staffErr } = await staffQuery;
  if (staffErr) throw staffErr;
  if (!staffRows || staffRows.length === 0) return [];

  const staffIds = staffRows.map((s) => s.id);
  const { data: attRows, error: attErr } = await supabase
    .from("staff_attendance")
    .select("staff_id, status, source, check_in_at")
    .eq("institution_id", ctx.institution.id)
    .eq("date", targetDate)
    .in("staff_id", staffIds);
  if (attErr) throw attErr;
  const attByStaff = new Map((attRows ?? []).map((r) => [r.staff_id, r]));
  const unavailable = await staffUnavailableOn(ctx, targetDate);

  return staffRows.map((s) => {
    const att = attByStaff.get(s.id);
    return {
      staffId: s.id,
      name: s.full_name,
      designation: s.designation,
      status: att?.status ?? null,
      source: att?.source ?? null,
      checkInAt: att?.check_in_at ?? null,
      onLeave: unavailable.get(s.id) === "leave",
    };
  });
}
