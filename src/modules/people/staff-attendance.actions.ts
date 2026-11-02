"use server";

// M08-T7 — staff attendance actions (rulings: staff_attendance). `mark` is a
// direct RLS upsert (table has no RPC — insert/update policies already
// scope it to owner/principal/admin; this handler additionally narrows the
// broader `staff.attendance.mark` permission to owner/principal/admin only,
// since teacher/admissions/accountant/exam_controller/student self rows are
// `checkIn`-only per 07 §2.2's `s` column note). `checkIn` is a thin
// wrapper over the `staff_check_in` RPC (0070 part 1), mirroring
// timetable/actions.ts's `publishVersion`.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { InstitutionSettingsSchema } from "@/modules/core/schemas";
import { CheckInSchema, StaffAttendanceMarkSchema, type StaffAttendanceMarkInput } from "@/modules/people/hr.schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

function isOwnerPrincipalAdmin(ctx: TenantContext): boolean {
  return ctx.membership.role === "owner" || ctx.membership.role === "principal" || ctx.membership.role === "admin";
}

/** `new Intl.DateTimeFormat` with `timeZone` gives the institution-local calendar date, not the server's. */
function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

export const markStaffAttendance = defineAction({
  name: "people.staffAttendance.mark",
  schema: StaffAttendanceMarkSchema,
  permission: "staff.attendance.mark",
  handler: async ({ date, records }: StaffAttendanceMarkInput, ctx) => {
    // createClient() first (C-03: a role that holds the broad
    // `staff.attendance.mark` permission but fails this narrower
    // owner/principal/admin-only check must still reach a real boundary —
    // same ordering as attendance/actions.ts's markAttendance).
    const supabase = await createClient();
    if (!isOwnerPrincipalAdmin(ctx)) {
      throw new AppError("forbidden", "Only owner, principal or admin can mark staff attendance.");
    }

    const locale = InstitutionSettingsSchema.shape.locale.safeParse(ctx.institution.settings.locale);
    const today = todayInTimezone(locale.success ? locale.data.timezone : "Asia/Kolkata");
    if (date > today) {
      throw new AppError("validation_failed", "Attendance date cannot be in the future.", { date: ["Cannot be in the future."] });
    }

    const staffIds = records.map((r) => r.staffId);
    const { data: leaveRows, error: leaveError } = await supabase
      .from("leave_requests")
      .select("staff_id")
      .eq("institution_id", ctx.institution.id)
      .eq("status", "approved")
      .in("staff_id", staffIds)
      .lte("start_date", date)
      .gte("end_date", date);
    if (leaveError) throwMapped(leaveError);
    const onLeave = new Set((leaveRows ?? []).map((r) => r.staff_id as string));
    if (onLeave.size > 0) {
      const violations = records
        .map((r, i) => (onLeave.has(r.staffId) ? `${i}: on approved leave` : null))
        .filter((v): v is string => v !== null);
      throw new AppError("invalid_state", "One or more staff are on approved leave for this date.", { records: violations });
    }

    const rows = records.map((r) => ({
      institution_id: ctx.institution.id,
      staff_id: r.staffId,
      date,
      status: r.status,
      note: r.note ?? null,
      source: "admin" as const,
      marked_by: ctx.user.id,
    }));
    const { data, error } = await supabase.from("staff_attendance").upsert(rows, { onConflict: "staff_id,date" }).select("id");
    if (error) {
      if (isRlsViolation(error)) {
        throw new AppError("validation_failed", "One or more staff are not active in this institution.", {
          records: ["One or more staff are not active in this institution."],
        });
      }
      throwMapped(error);
    }

    await audit(ctx, { action: "staff_attendance.marked", entityType: "staff_attendance", after: { date, count: records.length } });

    return { date, count: data?.length ?? records.length };
  },
});

export const checkIn = defineAction({
  name: "people.staffAttendance.checkIn",
  schema: CheckInSchema,
  permission: "staff.attendance.mark",
  handler: async (_input, ctx) => {
    if (!ctx.membership.staffId) {
      throw new AppError("forbidden", "You do not have a staff record.");
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("staff_check_in", { p_institution_id: ctx.institution.id });
    if (error) throwMapped(error);

    return {
      id: data.id,
      date: data.date,
      status: data.status,
      source: data.source,
      checkInAt: data.check_in_at,
    };
  },
});
