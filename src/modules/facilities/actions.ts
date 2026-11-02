"use server";

// M13-T5 — facilities.asset.upsert / maintenance.request / maintenance.assign
// / maintenance.close (M13-tasks.md Task 5, rulings). Mapping style mirrors
// timetable/actions.ts's throwMapped/isUniqueViolation/isRlsViolation (42501
// on RLS `with check` failure -> forbidden per the rulings' ErrorCode table;
// the guard trigger's own `code:invalid_state` passes through mapSqlError).
// LANE B: MOD not merged — no `module` field (controller ruling).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  AssetUpsertSchema,
  MaintenanceAssignSchema,
  MaintenanceCloseSchema,
  MaintenanceRequestSchema,
  type AssetUpsertInput,
  type MaintenanceAssignInput,
  type MaintenanceCloseInput,
  type MaintenanceRequestInput,
} from "@/modules/facilities/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

function isRlsViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_RLS_VIOLATION);
}

export const upsertAsset = defineAction({
  name: "facilities.asset.upsert",
  schema: AssetUpsertSchema,
  permission: "facilities.manage",
  handler: async ({ id, name, category, assetTag, roomId, location, status }: AssetUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      name,
      category,
      asset_tag: assetTag ?? null,
      room_id: roomId ?? null,
      location: location ?? null,
      ...(status !== undefined ? { status } : {}),
    };
    const query = id
      ? supabase.from("assets").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("assets").insert(row);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "An asset with this tag already exists.", { assetTag: ["Asset tag already in use."] });
      }
      if (isRlsViolation(error)) {
        throw new AppError("forbidden", "Room not found in this school.");
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Asset not found.");

    await audit(ctx, { action: "facilities.asset.upsert", entityType: "asset", entityId: data.id });

    return { id: data.id as string };
  },
});

export const raiseMaintenanceRequest = defineAction({
  name: "maintenance.request",
  schema: MaintenanceRequestSchema,
  permission: "maintenance.request",
  handler: async ({ assetId, location, issue, priority }: MaintenanceRequestInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("maintenance_requests")
      .insert({
        institution_id: ctx.institution.id,
        asset_id: assetId ?? null,
        location: location ?? null,
        issue,
        priority,
        raised_by: ctx.user.id,
      })
      .select("id, status")
      .single();
    if (error) {
      if (isRlsViolation(error)) {
        throw new AppError("forbidden", "Asset not found in this school.");
      }
      throwMapped(error);
    }

    await audit(ctx, { action: "maintenance.request", entityType: "maintenance_request", entityId: data.id, after: { status: data.status } });

    return { id: data.id as string };
  },
});

export const assignMaintenanceRequest = defineAction({
  name: "maintenance.assign",
  schema: MaintenanceAssignSchema,
  permission: "facilities.manage",
  handler: async ({ requestId, assigneeStaffId }: MaintenanceAssignInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("maintenance_requests")
      .update({ assignee_staff_id: assigneeStaffId, status: "in_progress" })
      .eq("id", requestId)
      .eq("institution_id", ctx.institution.id)
      .select("id, status")
      .maybeSingle();
    if (error) {
      if (isRlsViolation(error)) {
        throw new AppError("forbidden", "Assignee not found in this school.");
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Maintenance request not found.");

    await audit(ctx, {
      action: "maintenance.assign",
      entityType: "maintenance_request",
      entityId: data.id,
      after: { status: data.status },
    });

    return { id: data.id as string, status: data.status as "open" | "in_progress" | "done" };
  },
});

export const closeMaintenanceRequest = defineAction({
  name: "maintenance.close",
  schema: MaintenanceCloseSchema,
  permission: "facilities.manage",
  handler: async ({ requestId, resolutionNote }: MaintenanceCloseInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("maintenance_requests")
      .update({ status: "done", resolution_note: resolutionNote ?? null })
      .eq("id", requestId)
      .eq("institution_id", ctx.institution.id)
      .select("id, status")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Maintenance request not found.");

    await audit(ctx, {
      action: "maintenance.close",
      entityType: "maintenance_request",
      entityId: data.id,
      after: { status: data.status },
    });

    return { id: data.id as string, status: data.status as "open" | "in_progress" | "done" };
  },
});
