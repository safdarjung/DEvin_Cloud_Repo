"use server";

// Duty roster actions (migration 0132). Assignments and swaps change only through the definers
// (they enforce role, dates, leave, uniqueness and audit); duty types are plain RLS writes audited here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  DutyRangeSchema,
  DutySetAssignmentSchema,
  DutySwapCancelSchema,
  DutySwapRequestSchema,
  DutySwapRespondSchema,
  DutyTypeCreateSchema,
  DutyTypeUpdateSchema,
} from "@/modules/duties/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface RosterResult {
  created: number;
  schoolDays: number;
  skippedSundays: number;
  skippedHolidays: number;
  skippedAlreadyRostered: number;
  unfilledSlots: number;
}

export const createDutyType = defineAction({
  name: "duty.type.create",
  module: "duties",
  schema: DutyTypeCreateSchema,
  permission: "duty.manage",
  handler: async ({ name, slotsPerDay }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("duty_types").insert({ institution_id: ctx.institution.id, name, slots_per_day: slotsPerDay }).select("id").single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "duty.type.create", entityType: "duty_types", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateDutyType = defineAction({
  name: "duty.type.update",
  module: "duties",
  schema: DutyTypeUpdateSchema,
  permission: "duty.manage",
  handler: async ({ id, name, slotsPerDay, isActive }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("duty_types")
      .update({ name, slots_per_day: slotsPerDay, is_active: isActive })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Duty type not found.");
    await audit(ctx, { action: "duty.type.update", entityType: "duty_types", entityId: id });
    return { id };
  },
});

export const generateDutyRoster = defineAction({
  name: "duty.roster.generate",
  module: "duties",
  schema: DutyRangeSchema,
  permission: "duty.manage",
  handler: async ({ from, to }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("generate_duty_roster", { p_institution_id: ctx.institution.id, p_from: from, p_to: to });
    if (error) throwMapped(error);
    const r = data as Record<string, number> | null;
    if (!r) throw new AppError("internal", "Unexpected response shape.");
    return {
      created: r.created ?? 0,
      schoolDays: r.school_days ?? 0,
      skippedSundays: r.skipped_sundays ?? 0,
      skippedHolidays: r.skipped_holidays ?? 0,
      skippedAlreadyRostered: r.skipped_already_rostered ?? 0,
      unfilledSlots: r.unfilled_slots ?? 0,
    } satisfies RosterResult;
  },
});

export const setDutyAssignment = defineAction({
  name: "duty.assignment.set",
  module: "duties",
  schema: DutySetAssignmentSchema,
  permission: "duty.manage",
  handler: async ({ assignmentId, staffId, cancel }, ctx) => {
    void ctx;
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_duty_assignment", { p_assignment_id: assignmentId, p_staff_id: staffId, p_cancel: cancel ?? false });
    if (error) throwMapped(error);
    return { assignmentId };
  },
});

export const requestDutySwap = defineAction({
  name: "duty.swap.request",
  module: "duties",
  schema: DutySwapRequestSchema,
  permission: "duty.swap",
  handler: async ({ assignmentId, toStaffId }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("request_duty_swap", { p_assignment_id: assignmentId, p_to_staff_id: toStaffId });
    if (error) throwMapped(error);
    const r = data as { request_id: string } | null;
    if (!r) throw new AppError("internal", "Unexpected response shape.");
    return { requestId: r.request_id };
  },
});

export const respondDutySwap = defineAction({
  name: "duty.swap.respond",
  module: "duties",
  schema: DutySwapRespondSchema,
  permission: "duty.swap",
  handler: async ({ requestId, accept }) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("respond_duty_swap", { p_request_id: requestId, p_accept: accept });
    if (error) throwMapped(error);
    const r = data as { status: string } | null;
    if (!r) throw new AppError("internal", "Unexpected response shape.");
    return { requestId, status: r.status };
  },
});

export const cancelDutySwap = defineAction({
  name: "duty.swap.cancel",
  module: "duties",
  schema: DutySwapCancelSchema,
  permission: "duty.swap",
  handler: async ({ requestId }) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("cancel_duty_swap", { p_request_id: requestId });
    if (error) throwMapped(error);
    return { requestId };
  },
});
