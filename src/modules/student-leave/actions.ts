"use server";

// X01-T6 — studentLeave.request / studentLeave.approve / studentLeave.reject
// / studentLeave.cancel (X01-tasks.md Task 6 rulings; migration 0085 part 1's
// student_leave_requests + decide_student_leave RPC, built in T4). Style
// mirrors src/modules/people/leave.actions.ts (throwMapped/isRlsViolation).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import {
  StudentLeaveCancelSchema,
  StudentLeaveDecisionSchema,
  StudentLeaveRequestSchema,
  type StudentLeaveCancelInput,
  type StudentLeaveDecisionInput,
  type StudentLeaveRequestInput,
} from "@/modules/student-leave/schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

interface StudentLeaveDecisionRow {
  id: string;
  status: string;
}

function mapDecisionRow(row: Record<string, unknown>): StudentLeaveDecisionRow {
  return { id: row.id as string, status: row.status as string };
}

export const requestStudentLeave = defineAction({
  name: "studentLeave.request",
  module: "student_leave",
  schema: StudentLeaveRequestSchema,
  permission: "student_leave.request",
  handler: async ({ studentId, startDate, endDate, reason }: StudentLeaveRequestInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("student_leave_requests")
      .insert({
        institution_id: ctx.institution.id,
        student_id: studentId,
        // class_section_id and created_by are required columns in the
        // generated Insert type but the guard trigger always overwrites both
        // (from the student's active enrolment, and app.current_user_id()) —
        // same pattern as the RLS test fixtures' spoofed values.
        class_section_id: crypto.randomUUID(),
        created_by: ctx.user.id,
        start_date: startDate,
        end_date: endDate,
        reason,
      })
      .select("id, status")
      .single();
    if (error) {
      if (isRlsViolation(error)) {
        throw new AppError("forbidden", "You do not have permission to perform this action.");
      }
      throwMapped(error);
    }

    await audit(ctx, { action: "student_leave.requested", entityType: "student_leave_request", entityId: data.id });

    return mapDecisionRow(data);
  },
});

async function decideStudentLeave(
  _ctx: TenantContext,
  leaveId: string,
  decision: "approved" | "rejected" | "cancelled",
  note?: string,
): Promise<StudentLeaveDecisionRow> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_student_leave", {
    p_leave_id: leaveId,
    p_decision: decision,
    ...(note !== undefined ? { p_note: note } : {}),
  });
  if (error) throwMapped(error);
  return mapDecisionRow(data as Record<string, unknown>);
}

export const approveStudentLeave = defineAction({
  name: "studentLeave.approve",
  module: "student_leave",
  schema: StudentLeaveDecisionSchema,
  permission: "student_leave.approve",
  handler: async ({ leaveId, note }: StudentLeaveDecisionInput, ctx) => decideStudentLeave(ctx, leaveId, "approved", note),
});

export const rejectStudentLeave = defineAction({
  name: "studentLeave.reject",
  module: "student_leave",
  schema: StudentLeaveDecisionSchema,
  permission: "student_leave.approve",
  handler: async ({ leaveId, note }: StudentLeaveDecisionInput, ctx) => decideStudentLeave(ctx, leaveId, "rejected", note),
});

export const cancelStudentLeave = defineAction({
  name: "studentLeave.cancel",
  module: "student_leave",
  schema: StudentLeaveCancelSchema,
  permission: "student_leave.request",
  handler: async ({ leaveId }: StudentLeaveCancelInput, ctx) => decideStudentLeave(ctx, leaveId, "cancelled"),
});
