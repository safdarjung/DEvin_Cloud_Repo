"use server";

// M08-T8 — people.leave.request / people.leave.approve / people.leave.reject
// / people.leave.cancel (M08-tasks.md Task 8 rulings; migration 0070 part 1's
// leave_requests + decide_leave RPC, built in T2). Style mirrors
// src/modules/timetable/actions.ts (throwMapped/isRlsViolation helpers).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import {
  LeaveCancelSchema,
  LeaveDecisionSchema,
  LeaveRequestSchema,
  type LeaveCancelInput,
  type LeaveDecisionInput,
  type LeaveRequestInput,
} from "@/modules/people/hr.schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

function isStaffAdmin(role: string): boolean {
  return role === "owner" || role === "principal" || role === "admin";
}

interface LeaveRow {
  id: string;
  staffId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

function mapLeaveRow(row: Record<string, unknown>): LeaveRow {
  return {
    id: row.id as string,
    staffId: row.staff_id as string,
    leaveType: row.leave_type as string,
    startDate: row.start_date as string,
    endDate: row.end_date as string,
    status: row.status as string,
    decidedAt: (row.decided_at as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
  };
}

export const requestLeave = defineAction({
  name: "people.leave.request",
  module: "staff_attendance",
  schema: LeaveRequestSchema,
  permission: "leave.request",
  handler: async ({ staffId, leaveType, startDate, endDate, reason }: LeaveRequestInput, ctx) => {
    const targetStaffId = staffId ?? ctx.membership.staffId;
    if (!targetStaffId) {
      throw new AppError("forbidden", "No staff record for this account.");
    }
    if (staffId && staffId !== ctx.membership.staffId && !isStaffAdmin(ctx.membership.role)) {
      throw new AppError("forbidden", "You do not have permission to perform this action.");
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("leave_requests")
      .insert({
        institution_id: ctx.institution.id,
        staff_id: targetStaffId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reason,
        created_by: ctx.user.id,
      })
      .select("id, staff_id, leave_type, start_date, end_date, status, decided_at, decision_note")
      .single();
    if (error) {
      if (isRlsViolation(error)) {
        throw new AppError("forbidden", "You do not have permission to perform this action.");
      }
      throwMapped(error);
    }

    await audit(ctx, { action: "leave.requested", entityType: "leave_request", entityId: data.id });

    return mapLeaveRow(data);
  },
});

async function decideLeave(_ctx: TenantContext, leaveId: string, decision: "approved" | "rejected" | "cancelled", note?: string): Promise<LeaveRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_leave", {
    p_leave_id: leaveId,
    p_decision: decision,
    ...(note !== undefined ? { p_note: note } : {}),
  });
  if (error) throwMapped(error);
  return mapLeaveRow(data as Record<string, unknown>);
}

export const approveLeave = defineAction({
  name: "people.leave.approve",
  module: "staff_attendance",
  schema: LeaveDecisionSchema,
  permission: "leave.approve",
  handler: async ({ leaveId, note }: LeaveDecisionInput, ctx) => decideLeave(ctx, leaveId, "approved", note),
});

export const rejectLeave = defineAction({
  name: "people.leave.reject",
  module: "staff_attendance",
  schema: LeaveDecisionSchema,
  permission: "leave.approve",
  handler: async ({ leaveId, note }: LeaveDecisionInput, ctx) => decideLeave(ctx, leaveId, "rejected", note),
});

export const cancelLeave = defineAction({
  name: "people.leave.cancel",
  module: "staff_attendance",
  schema: LeaveCancelSchema,
  permission: "leave.request",
  handler: async ({ leaveId }: LeaveCancelInput, ctx) => decideLeave(ctx, leaveId, "cancelled"),
});
