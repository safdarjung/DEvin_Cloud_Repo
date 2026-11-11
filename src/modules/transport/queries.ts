import "server-only";
// M13-T9 — transport.* reads: the fabric TransportRoute[] fixture
// (src/modules/fabric/types.ts, generator transportRoutes in
// src/modules/fabric/demo/operations.ts) replacement + a per-student lookup.
// RLS (0075) narrows transport_assignments to the caller's own/taught
// students; the institution_id filters below are defense in depth, same
// shape as every other queries.ts in this codebase. Mirrors
// src/modules/timetable/queries.ts.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { TransportRoute } from "@/modules/fabric/types";

export interface StudentTransport {
  studentId: string;
  routeId: string;
  routeName: string;
  vehicle: string | null;
  driver: string | null;
  status: "on_time" | "delayed" | "off_road";
  stop: { name: string; eta: string };
}

function toHHMM(time: string): string {
  return time.slice(0, 5); // postgrest "time" -> "HH:MM:SS"
}

interface StopRow {
  id: string;
  route_id: string;
  seq: number;
  name: string;
  pickup_time: string;
  map_x: number;
  map_y: number;
}

export interface TransportRouteDetail extends Omit<TransportRoute, "stops"> {
  vehicleId: string | null;
  stops: (TransportRoute["stops"][number] & { id: string; seq: number })[];
}

export interface TransportVehicle {
  id: string;
  registrationNo: string;
  driverName: string;
  capacity: number;
  status: "active" | "off_road";
}

const MAX_VEHICLES = 200;
const PAGE_SIZE = 1000; // PostgREST max_rows (supabase/config.toml)

/** transport.manage fleet list for the vehicle form and route vehicle picker. */
export async function transportVehicles(ctx: TenantContext): Promise<TransportVehicle[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transport_vehicles")
    .select("id, registration_no, driver_name, capacity, status")
    .eq("institution_id", ctx.institution.id)
    .order("registration_no", { ascending: true })
    .limit(MAX_VEHICLES);
  if (error) throw error;
  return (data ?? []).map((v) => ({
    id: v.id,
    registrationNo: v.registration_no,
    driverName: v.driver_name,
    capacity: v.capacity,
    status: v.status as TransportVehicle["status"],
  }));
}

// Pages past PostgREST's max_rows cap so the per-stop/route counts stay exact.
async function allAssignments(institutionId: string): Promise<{ route_id: string; stop_id: string }[]> {
  const supabase = await createClient();
  const rows: { route_id: string; stop_id: string }[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("transport_assignments")
      .select("route_id, stop_id")
      .eq("institution_id", institutionId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Every route in the institution with its vehicle, stops (seq order, with
 * per-stop assignment counts) and overall assigned count — the demo
 * TransportRoute[] fixture replacement. Requires transport.manage
 * (owner/principal/admin); RLS additionally lets all 7 staff roles read
 * the underlying tables.
 */
export async function transportRoutes(ctx: TenantContext): Promise<TransportRouteDetail[]> {
  const supabase = await createClient();
  const [routesRes, vehiclesRes, stopsRes, assignmentRows] = await Promise.all([
    supabase.from("transport_routes").select("id, name, status, vehicle_id").eq("institution_id", ctx.institution.id),
    supabase.from("transport_vehicles").select("id, registration_no, driver_name, capacity").eq("institution_id", ctx.institution.id),
    supabase
      .from("transport_stops")
      .select("id, route_id, seq, name, pickup_time, map_x, map_y")
      .eq("institution_id", ctx.institution.id)
      .order("seq", { ascending: true }),
    allAssignments(ctx.institution.id),
  ]);
  if (routesRes.error) throw routesRes.error;
  if (vehiclesRes.error) throw vehiclesRes.error;
  if (stopsRes.error) throw stopsRes.error;

  const vehicleById = new Map((vehiclesRes.data ?? []).map((v) => [v.id, v]));
  const stopsByRoute = new Map<string, StopRow[]>();
  for (const stop of stopsRes.data ?? []) {
    const list = stopsByRoute.get(stop.route_id) ?? [];
    list.push(stop);
    stopsByRoute.set(stop.route_id, list);
  }
  const studentsByStop = new Map<string, number>();
  const assignedByRoute = new Map<string, number>();
  for (const a of assignmentRows) {
    studentsByStop.set(a.stop_id, (studentsByStop.get(a.stop_id) ?? 0) + 1);
    assignedByRoute.set(a.route_id, (assignedByRoute.get(a.route_id) ?? 0) + 1);
  }

  return (routesRes.data ?? []).map((route) => {
    const vehicle = route.vehicle_id ? vehicleById.get(route.vehicle_id) : undefined;
    return {
      id: route.id,
      name: route.name,
      vehicle: vehicle?.registration_no ?? "",
      driver: vehicle?.driver_name ?? "",
      vehicleId: route.vehicle_id,
      stops: (stopsByRoute.get(route.id) ?? []).map((s) => ({
        id: s.id,
        seq: s.seq,
        name: s.name,
        eta: toHHMM(s.pickup_time),
        students: studentsByStop.get(s.id) ?? 0,
        x: s.map_x,
        y: s.map_y,
      })),
      status: route.status as TransportRoute["status"],
      capacity: vehicle?.capacity ?? 0,
      assigned: assignedByRoute.get(route.id) ?? 0,
    };
  });
}

/**
 * The caller's visible transport assignment for one student — null when
 * there is no assignment, or RLS hides it (another family's child, or a
 * student a teacher doesn't teach). RLS scopes transport_assignments to
 * the caller's own/taught students; this just shapes whatever row (if any)
 * the caller is allowed to read.
 */
export async function transportForStudent(ctx: TenantContext, studentId: string): Promise<StudentTransport | null> {
  const supabase = await createClient();
  const { data: assignment, error } = await supabase
    .from("transport_assignments")
    .select(
      // transport_stops!stop_id disambiguates: transport_assignments has two
      // FK paths to transport_stops (stop_id alone, and the composite
      // (stop_id, route_id) that pins a stop to its own route) — PostgREST
      // can't pick one without the hint.
      "route_id, transport_routes(name, status, transport_vehicles(registration_no, driver_name)), transport_stops!stop_id(name, pickup_time)",
    )
    .eq("institution_id", ctx.institution.id)
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  if (!assignment) return null;

  const route = assignment.transport_routes as {
    name: string;
    status: string;
    transport_vehicles: { registration_no: string; driver_name: string } | null;
  } | null;
  const stop = assignment.transport_stops as { name: string; pickup_time: string } | null;
  if (!route || !stop) return null;

  return {
    studentId,
    routeId: assignment.route_id,
    routeName: route.name,
    vehicle: route.transport_vehicles?.registration_no ?? null,
    driver: route.transport_vehicles?.driver_name ?? null,
    status: route.status as StudentTransport["status"],
    stop: { name: stop.name, eta: toHHMM(stop.pickup_time) },
  };
}
