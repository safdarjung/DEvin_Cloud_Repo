"use server";

// M13-T6 — transport.vehicle.upsert / transport.route.upsert /
// transport.stop.upsert / transport.assign / transport.unassign.
// Mapping style mirrors src/modules/timetable/actions.ts. Lane B ruling:
// no `module` field (MOD not merged in this tree yet).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  RouteUpsertSchema,
  StopUpsertSchema,
  TransportAssignSchema,
  TransportUnassignSchema,
  VehicleUpsertSchema,
  type RouteUpsertInput,
  type StopUpsertInput,
  type TransportAssignInput,
  type TransportUnassignInput,
  type VehicleUpsertInput,
} from "@/modules/transport/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_RLS_VIOLATION = "42501";
const POSTGRES_FK_VIOLATION = "23503";

function sqlErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? (error as { code?: string }).code : undefined;
}

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** 23505 by constraint name (M13-tasks.md rulings: "ErrorCode mapping"). */
function throwUniqueViolation(error: unknown): never {
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (message.includes("transport_vehicles_registration_key")) {
    throw new AppError("conflict", "A vehicle with this registration number already exists.", {
      registrationNo: ["Registration number already in use."],
    });
  }
  if (message.includes("transport_routes_name_key")) {
    throw new AppError("conflict", "A route with this name already exists.", { name: ["Name already in use."] });
  }
  if (message.includes("transport_stops_seq_key")) {
    throw new AppError("conflict", "A stop with this sequence number already exists on this route.", {
      seq: ["Sequence already in use on this route."],
    });
  }
  if (message.includes("transport_assignments_student_key")) {
    throw new AppError("conflict", "This student already has a transport assignment.", {
      studentId: ["Already assigned."],
    });
  }
  throwMapped(error);
}

function throwForWriteError(error: unknown, notFoundMessage: string): never {
  const code = sqlErrorCode(error);
  if (code === POSTGRES_UNIQUE_VIOLATION) throwUniqueViolation(error);
  if (code === POSTGRES_RLS_VIOLATION) {
    throw new AppError("forbidden", "You do not have permission to perform this action.");
  }
  if (code === POSTGRES_FK_VIOLATION) throw new AppError("not_found", notFoundMessage);
  throwMapped(error);
}

export const upsertVehicle = defineAction({
  name: "transport.vehicle.upsert",
  schema: VehicleUpsertSchema,
  permission: "transport.manage",
  handler: async ({ id, registrationNo, capacity, driverName, status }: VehicleUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      registration_no: registrationNo,
      capacity,
      driver_name: driverName,
      ...(status !== undefined ? { status } : {}),
    };
    const query = id
      ? supabase.from("transport_vehicles").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("transport_vehicles").insert(row);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throwForWriteError(error, "Vehicle not found.");
    if (!data) throw new AppError("not_found", "Vehicle not found.");

    await audit(ctx, { action: "transport.vehicle.upsert", entityType: "transport_vehicle", entityId: data.id as string });

    return { id: data.id as string };
  },
});

export const upsertRoute = defineAction({
  name: "transport.route.upsert",
  schema: RouteUpsertSchema,
  permission: "transport.manage",
  handler: async ({ id, name, vehicleId, status }: RouteUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      name,
      ...(vehicleId !== undefined ? { vehicle_id: vehicleId } : {}),
      ...(status !== undefined ? { status } : {}),
    };
    const query = id
      ? supabase.from("transport_routes").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("transport_routes").insert(row);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throwForWriteError(error, "Vehicle not found.");
    if (!data) throw new AppError("not_found", "Route not found.");

    await audit(ctx, { action: "transport.route.upsert", entityType: "transport_route", entityId: data.id as string });

    return { id: data.id as string };
  },
});

export const upsertStop = defineAction({
  name: "transport.stop.upsert",
  schema: StopUpsertSchema,
  permission: "transport.manage",
  handler: async ({ id, routeId, seq, name, eta, mapX, mapY }: StopUpsertInput, ctx) => {
    const supabase = await createClient();
    const row = {
      institution_id: ctx.institution.id,
      route_id: routeId,
      seq,
      name,
      pickup_time: eta,
      map_x: mapX,
      map_y: mapY,
    };
    const query = id
      ? supabase.from("transport_stops").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("transport_stops").insert(row);
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throwForWriteError(error, "Route not found.");
    if (!data) throw new AppError("not_found", "Stop not found.");

    await audit(ctx, { action: "transport.stop.upsert", entityType: "transport_stop", entityId: data.id as string });

    return { id: data.id as string };
  },
});

export const assignTransport = defineAction({
  name: "transport.assign",
  schema: TransportAssignSchema,
  permission: "transport.manage",
  handler: async ({ studentId, stopId }: TransportAssignInput, ctx) => {
    const supabase = await createClient();

    // Route is read from the stop, not supplied by the caller. RLS scopes
    // transport_stops to the caller's own institution, so a stop belonging
    // to another institution is invisible here — treated as `forbidden`
    // (not `not_found`), the same BOLA-safe choice as a cross-institution
    // assignee elsewhere in M13, rather than leaking whether the id exists.
    const { data: stop, error: stopError } = await supabase
      .from("transport_stops")
      .select("route_id")
      .eq("id", stopId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (stopError) throwMapped(stopError);
    if (!stop) throw new AppError("forbidden", "You do not have permission to perform this action.");

    const { data, error } = await supabase
      .from("transport_assignments")
      .upsert(
        {
          institution_id: ctx.institution.id,
          student_id: studentId,
          route_id: stop.route_id,
          stop_id: stopId,
          assigned_by: ctx.user.id,
        },
        { onConflict: "student_id" },
      )
      .select("id, route_id, stop_id")
      .single();
    if (error) throwForWriteError(error, "Student not found.");

    await audit(ctx, {
      action: "transport.assign",
      entityType: "transport_assignment",
      entityId: data.id as string,
      after: { studentId, routeId: data.route_id as string, stopId: data.stop_id as string },
    });

    return { id: data.id as string, routeId: data.route_id as string, stopId: data.stop_id as string };
  },
});

export const unassignTransport = defineAction({
  name: "transport.unassign",
  schema: TransportUnassignSchema,
  permission: "transport.manage",
  handler: async ({ studentId }: TransportUnassignInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("transport_assignments")
      .delete()
      .eq("student_id", studentId)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "No transport assignment found for this student.");

    await audit(ctx, { action: "transport.unassign", entityType: "transport_assignment", entityId: data.id as string, after: { studentId } });

    return { studentId };
  },
});
