"use server";

// X07-T4 — visitors.checkIn / visitors.checkOut / visitors.purge
// (X07-tasks.md Task 4 rulings; migration 0090). Mapping style mirrors
// facilities/actions.ts's throwMapped/isRlsViolation (42501 on RLS `with
// check` failure -> forbidden, e.g. a hostStaffId from another
// institution). The state machine (double check-out -> invalid_state) is
// `app.guard_visitor_entries` (0090), surfaced via mapSqlError's
// `code:invalid_state` passthrough. Retention purge (180 days) is enforced
// by the `visitor_entries_delete` RLS policy, not re-implemented here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  VisitorCheckInSchema,
  VisitorCheckOutSchema,
  VisitorPurgeSchema,
  type VisitorCheckInInput,
  type VisitorCheckOutInput,
} from "@/modules/visitors/schemas";

const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

export const checkInVisitor = defineAction({
  name: "visitors.checkIn",
  module: "visitors",
  schema: VisitorCheckInSchema,
  permission: "visitor.manage",
  handler: async ({ fullName, phone, purpose, hostStaffId, meetingWith, idType, idLast4 }: VisitorCheckInInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("visitor_entries")
      .insert({
        institution_id: ctx.institution.id,
        full_name: fullName,
        phone,
        purpose,
        host_staff_id: hostStaffId ?? null,
        meeting_with: meetingWith ?? null,
        id_type: idType ?? null,
        id_last4: idLast4 ?? null,
        // Trigger-forced to the caller for a real user JWT (guard_visitor_entries,
        // 0090); supplied only to satisfy the not-null column/insert type.
        checked_in_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) {
      if (isRlsViolation(error)) throw new AppError("forbidden", "Host staff member not found in this school.");
      throwMapped(error);
    }

    await audit(ctx, { action: "visitors.check_in", entityType: "visitor_entries", entityId: data.id });

    return { id: data.id as string };
  },
});

export const checkOutVisitor = defineAction({
  name: "visitors.checkOut",
  module: "visitors",
  schema: VisitorCheckOutSchema,
  permission: "visitor.manage",
  handler: async ({ id }: VisitorCheckOutInput, ctx) => {
    const supabase = await createClient();
    // The guard trigger forces checked_out_at/checked_out_by server-side and
    // raises code:invalid_state on a second check-out; the value sent here
    // is only to make this an UPDATE on that column (lesson: direct writes
    // obey the same rules).
    const { data, error } = await supabase
      .from("visitor_entries")
      .update({ checked_out_at: new Date().toISOString() })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id, checked_out_at")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Visitor entry not found.");

    await audit(ctx, { action: "visitors.check_out", entityType: "visitor_entries", entityId: data.id });

    return { id: data.id as string, checkedOutAt: data.checked_out_at as string };
  },
});

export const purgeVisitors = defineAction({
  name: "visitors.purge",
  module: "visitors",
  schema: VisitorPurgeSchema,
  permission: "visitor.manage",
  handler: async (_input, ctx) => {
    const supabase = await createClient();
    // `visitor_entries_delete` RLS already restricts this to rows past the
    // 180-day retention window (VISITOR_RETENTION_DAYS) — no age filter
    // duplicated here.
    const { data, error } = await supabase.from("visitor_entries").delete().eq("institution_id", ctx.institution.id).select("id");
    if (error) throwMapped(error);
    const deleted = data?.length ?? 0;

    await audit(ctx, { action: "visitors.purge", entityType: "visitor_entries", after: { deleted } });

    return { deleted };
  },
});
