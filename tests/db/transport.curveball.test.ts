// Curveball sweep (transport): last-seat race, capacity shrink below riders, cross-tenant student, Zod edges.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { assignTransport, upsertRoute, upsertStop, upsertVehicle } from "@/modules/transport/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let a: TestInstitution;
let b: TestInstitution;

async function student(inst: TestInstitution = a): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${inst.institutionId}, ${`TCB-${crypto.randomUUID().slice(0, 8)}`}, 'Rider', '2015-01-01', 'other') returning id`;
  return row.id as string;
}
async function route(capacity: number) {
  const registrationNo = `MH${crypto.randomUUID().slice(0, 6)}`;
  const v = await callAs(a, "admin", upsertVehicle, { registrationNo, capacity, driverName: "Driver" });
  if (!v.ok) throw new Error(v.error.code);
  const r = await callAs(a, "admin", upsertRoute, { name: `R-${crypto.randomUUID().slice(0, 6)}`, vehicleId: v.data.id });
  if (!r.ok) throw new Error(r.error.code);
  const s = await callAs(a, "admin", upsertStop, { routeId: r.data.id, seq: 1, name: "Gate", eta: "07:00", mapX: 1, mapY: 1 });
  if (!s.ok) throw new Error(s.error.code);
  return { vehicleId: v.data.id, registrationNo, routeId: r.data.id, stopId: s.data.id };
}
async function riders(routeId: string): Promise<number> {
  const [c] = await sql`select count(*)::int as n from public.transport_assignments where route_id = ${routeId}`;
  return c.n as number;
}

beforeAll(async () => {
  a = await createTestInstitution("transport-cb");
  b = await createTestInstitution("transport-cb-x");
}, 60_000);

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("transport curveballs", () => {
  it("last seat: four students race for a 1-seat bus — exactly one rides", async () => {
    const { routeId, stopId } = await route(1);
    const students = await Promise.all([1, 2, 3, 4].map(() => student()));
    const rs = await Promise.all(students.map((studentId) => callAs(a, "admin", assignTransport, { studentId, stopId })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.filter((r) => !r.ok).every((r) => !r.ok && r.error.code === "conflict")).toBe(true);
    expect(await riders(routeId)).toBe(1);
  });

  // Regression (fixed in 0145): The capacity guard runs only on transport_assignments; nothing stops the bus shrinking under its riders
  // (hostel rooms refuse the same edit with code:conflict).
  it("lowering a vehicle's capacity below its current riders is refused", async () => {
    const { vehicleId, registrationNo, routeId, stopId } = await route(2);
    for (let i = 0; i < 2; i++) expect((await callAs(a, "admin", assignTransport, { studentId: await student(), stopId })).ok).toBe(true);
    const shrink = await callAs(a, "admin", upsertVehicle, { id: vehicleId, registrationNo, capacity: 1, driverName: "Driver" });
    expect(shrink.ok ? "ok" : shrink.error.code).toBe("conflict");
    const [v] = await sql`select capacity from public.transport_vehicles where id = ${vehicleId}`;
    expect(Number(v.capacity)).toBeGreaterThanOrEqual(await riders(routeId));
  });

  it("swapping a route onto a vehicle smaller than its riders is refused", async () => {
    const { vehicleId, routeId, stopId } = await route(2);
    for (let i = 0; i < 2; i++) expect((await callAs(a, "admin", assignTransport, { studentId: await student(), stopId })).ok).toBe(true);
    const small = await callAs(a, "admin", upsertVehicle, { registrationNo: `MH${crypto.randomUUID().slice(0, 6)}`, capacity: 1, driverName: "Driver" });
    if (!small.ok) throw new Error(small.error.code);
    const swap = await callAs(a, "admin", upsertRoute, { id: routeId, name: `R-${crypto.randomUUID().slice(0, 6)}`, vehicleId: small.data.id });
    expect(swap.ok ? "ok" : swap.error.code).toBe("conflict");
    const [r] = await sql`select vehicle_id from public.transport_routes where id = ${routeId}`;
    expect(r.vehicle_id).toBe(vehicleId);
  });

  it("assigning another school's student → refused (not internal), nothing written", async () => {
    const { routeId, stopId } = await route(5);
    const r = await callAs(a, "admin", assignTransport, { studentId: await student(b), stopId });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.code).not.toBe("internal");
    expect(await riders(routeId)).toBe(0);
  });

  it.each([
    ["capacity 0", { capacity: 0 }, "capacity"],
    ["capacity 101", { capacity: 101 }, "capacity"],
    ["fractional capacity", { capacity: 2.5 }, "capacity"],
    ["blank driver", { driverName: "  " }, "driverName"],
  ])("vehicle: %s → validation_failed on %s", async (_l, patch, field) => {
    const r = await callAs(a, "admin", upsertVehicle, { registrationNo: "MH01AB1234", capacity: 10, driverName: "D", ...patch });
    expect(r.ok ? null : r.error.fieldErrors?.[field as string]).toBeTruthy();
  });

  it("stop: map coordinates out of 0..100 and seq 0 → validation_failed", async () => {
    const { routeId } = await route(3);
    const r = await callAs(a, "admin", upsertStop, { routeId, seq: 0, name: "X", eta: "07:00", mapX: 101, mapY: -1 });
    expect(Object.keys(r.ok ? {} : (r.error.fieldErrors ?? {}))).toEqual(expect.arrayContaining(["seq", "mapX", "mapY"]));
  });
});
