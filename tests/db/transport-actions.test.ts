import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { assignTransport, unassignTransport, upsertRoute, upsertStop, upsertVehicle } from "@/modules/transport/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

// M13-T6 — transport.vehicle.upsert / transport.route.upsert /
// transport.stop.upsert / transport.assign / transport.unassign. Columns
// exactly as 0075: transport_vehicles.{registration_no, capacity,
// driver_name, status}, transport_routes.{name, vehicle_id, status},
// transport_stops.{route_id, seq, name, pickup_time, map_x, map_y},
// transport_assignments.{student_id, route_id, stop_id, assigned_by}.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function createExtraStudent(institutionId: string, label: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, ${label}, '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

describe("transport.vehicle.upsert / transport.route.upsert / transport.stop.upsert", () => {
  it("admin creates a vehicle, route and stop", async () => {
    const inst = await createTestInstitution("transport-upsert");
    try {
      const vehicle = await callAs(inst, "admin", upsertVehicle, {
        registrationNo: "MH12AB1234",
        capacity: 2,
        driverName: "Driver One",
      });
      expect(vehicle.ok).toBe(true);
      if (!vehicle.ok) return;

      const route = await callAs(inst, "admin", upsertRoute, { name: "Route One", vehicleId: vehicle.data.id });
      expect(route.ok).toBe(true);
      if (!route.ok) return;

      const stop = await callAs(inst, "admin", upsertStop, {
        routeId: route.data.id,
        seq: 1,
        name: "Stop One",
        eta: "07:00",
        mapX: 10,
        mapY: 10,
      });
      expect(stop.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot upsert a vehicle, route or stop", async () => {
    const inst = await createTestInstitution("transport-forbidden");
    try {
      const vehicle = await callAs(inst, "teacher", upsertVehicle, {
        registrationNo: "MH12AB9999",
        capacity: 10,
        driverName: "Driver",
      });
      expect(vehicle.ok).toBe(false);
      if (vehicle.ok) return;
      expect(vehicle.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("duplicate registration number → conflict with fieldErrors.registrationNo", async () => {
    const inst = await createTestInstitution("transport-dup-reg");
    try {
      const first = await callAs(inst, "admin", upsertVehicle, { registrationNo: "MH12AB0001", capacity: 10, driverName: "Driver" });
      expect(first.ok).toBe(true);

      const dup = await callAs(inst, "admin", upsertVehicle, { registrationNo: "MH12AB0001", capacity: 20, driverName: "Driver Two" });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe("conflict");
      expect(dup.error.fieldErrors?.registrationNo).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("duplicate stop seq on the same route → conflict with fieldErrors.seq", async () => {
    const inst = await createTestInstitution("transport-dup-seq");
    try {
      const route = await callAs(inst, "admin", upsertRoute, { name: "Route Dup" });
      expect(route.ok).toBe(true);
      if (!route.ok) return;

      const first = await callAs(inst, "admin", upsertStop, { routeId: route.data.id, seq: 1, name: "Stop A", eta: "07:00", mapX: 1, mapY: 1 });
      expect(first.ok).toBe(true);

      const dup = await callAs(inst, "admin", upsertStop, { routeId: route.data.id, seq: 1, name: "Stop B", eta: "07:10", mapX: 2, mapY: 2 });
      expect(dup.ok).toBe(false);
      if (dup.ok) return;
      expect(dup.error.code).toBe("conflict");
      expect(dup.error.fieldErrors?.seq).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });
});

describe("transport.assign / transport.unassign", () => {
  async function setupRouteWithCapacity(inst: TestInstitution, capacity: number): Promise<{ routeId: string; stopIds: string[] }> {
    const vehicle = await callAs(inst, "admin", upsertVehicle, { registrationNo: `MH${crypto.randomUUID().slice(0, 6)}`, capacity, driverName: "Driver" });
    if (!vehicle.ok) throw new Error("vehicle setup failed");
    const route = await callAs(inst, "admin", upsertRoute, { name: `Route-${crypto.randomUUID().slice(0, 6)}`, vehicleId: vehicle.data.id });
    if (!route.ok) throw new Error("route setup failed");
    const stop1 = await callAs(inst, "admin", upsertStop, { routeId: route.data.id, seq: 1, name: "Stop 1", eta: "07:00", mapX: 10, mapY: 10 });
    const stop2 = await callAs(inst, "admin", upsertStop, { routeId: route.data.id, seq: 2, name: "Stop 2", eta: "07:10", mapX: 20, mapY: 20 });
    if (!stop1.ok || !stop2.ok) throw new Error("stop setup failed");
    return { routeId: route.data.id, stopIds: [stop1.data.id, stop2.data.id] };
  }

  it("assigns up to capacity, then a third assignment is rejected as route full", async () => {
    const inst = await createTestInstitution("transport-capacity");
    try {
      const { stopIds } = await setupRouteWithCapacity(inst, 2);
      const sA = await createExtraStudent(inst.institutionId, "Student A");
      const sB = await createExtraStudent(inst.institutionId, "Student B");
      const sC = await createExtraStudent(inst.institutionId, "Student C");

      const a = await callAs(inst, "admin", assignTransport, { studentId: sA, stopId: stopIds[0] });
      expect(a.ok).toBe(true);
      const b = await callAs(inst, "admin", assignTransport, { studentId: sB, stopId: stopIds[1] });
      expect(b.ok).toBe(true);

      const c = await callAs(inst, "admin", assignTransport, { studentId: sC, stopId: stopIds[0] });
      expect(c.ok).toBe(false);
      if (c.ok) return;
      expect(c.error.code).toBe("conflict");
      expect(c.error.message).toContain("route is full");
    } finally {
      await inst.cleanup();
    }
  });

  it("moving a student to the other stop on the same route keeps one row", async () => {
    const inst = await createTestInstitution("transport-move");
    try {
      const { routeId, stopIds } = await setupRouteWithCapacity(inst, 5);
      const studentId = await createExtraStudent(inst.institutionId, "Mover");

      const first = await callAs(inst, "admin", assignTransport, { studentId, stopId: stopIds[0] });
      expect(first.ok).toBe(true);
      const moved = await callAs(inst, "admin", assignTransport, { studentId, stopId: stopIds[1] });
      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      expect(moved.data.stopId).toBe(stopIds[1]);
      expect(moved.data.routeId).toBe(routeId);

      const [row] = await sql`select count(*)::int as n from public.transport_assignments where student_id = ${studentId}`;
      expect(row.n).toBe(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("moving a student to the other stop on a route exactly at capacity still succeeds", async () => {
    const inst = await createTestInstitution("transport-move-at-cap");
    try {
      const { routeId, stopIds } = await setupRouteWithCapacity(inst, 1);
      const studentId = await createExtraStudent(inst.institutionId, "AtCap");

      const first = await callAs(inst, "admin", assignTransport, { studentId, stopId: stopIds[0] });
      expect(first.ok).toBe(true);

      const moved = await callAs(inst, "admin", assignTransport, { studentId, stopId: stopIds[1] });
      expect(moved.ok).toBe(true);
      if (!moved.ok) return;
      expect(moved.data.stopId).toBe(stopIds[1]);
      expect(moved.data.routeId).toBe(routeId);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot assign transport", async () => {
    const inst = await createTestInstitution("transport-assign-forbidden");
    try {
      const { stopIds } = await setupRouteWithCapacity(inst, 5);
      const studentId = await createExtraStudent(inst.institutionId, "Nope");
      const result = await callAs(inst, "teacher", assignTransport, { studentId, stopId: stopIds[0] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("unassigning twice returns not_found the second time", async () => {
    const inst = await createTestInstitution("transport-unassign-twice");
    try {
      const { stopIds } = await setupRouteWithCapacity(inst, 5);
      const studentId = await createExtraStudent(inst.institutionId, "Once");
      const assigned = await callAs(inst, "admin", assignTransport, { studentId, stopId: stopIds[0] });
      expect(assigned.ok).toBe(true);

      const first = await callAs(inst, "admin", unassignTransport, { studentId });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "admin", unassignTransport, { studentId });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("a stop belonging to another institution → forbidden", async () => {
    await withTwoInstitutions(async (a, b) => {
      const { stopIds } = await setupRouteWithCapacity(b, 5);
      const studentId = await createExtraStudent(a.institutionId, "Cross");

      const result = await callAs(a, "admin", assignTransport, { studentId, stopId: stopIds[0] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    });
  });
});
