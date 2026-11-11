// M13-T9 — src/modules/transport/queries.ts, called directly as plain
// query functions (buildContext + setActingClient pattern), plus the
// query-defs.ts wrapper via callAs for the permission-gate case. Mirrors
// tests/db/timetable-queries.test.ts.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { transportForStudent, transportRoutes } from "@/modules/transport/queries";
import { transportRoutesQuery } from "@/modules/transport/query-defs";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function createVehicle(
  institutionId: string,
  overrides: Partial<{ registrationNo: string; capacity: number; driverName: string }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.transport_vehicles (institution_id, registration_no, capacity, driver_name)
    values (${institutionId}, ${overrides.registrationNo ?? `MH-${crypto.randomUUID().slice(0, 6)}`}, ${overrides.capacity ?? 40}, ${overrides.driverName ?? "Test Driver"})
    returning id
  `;
  return row.id as string;
}

async function createRoute(institutionId: string, vehicleId: string | null, name?: string): Promise<string> {
  const [row] = await sql`
    insert into public.transport_routes (institution_id, name, vehicle_id)
    values (${institutionId}, ${name ?? `Route-${crypto.randomUUID().slice(0, 6)}`}, ${vehicleId})
    returning id
  `;
  return row.id as string;
}

async function createStop(
  institutionId: string,
  routeId: string,
  seq: number,
  overrides: Partial<{ name: string; pickupTime: string; mapX: number; mapY: number }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.transport_stops (institution_id, route_id, seq, name, pickup_time, map_x, map_y)
    values (${institutionId}, ${routeId}, ${seq}, ${overrides.name ?? `Stop ${seq}`}, ${overrides.pickupTime ?? "07:00"}, ${overrides.mapX ?? 10}, ${overrides.mapY ?? 10})
    returning id
  `;
  return row.id as string;
}

async function createStudent(institutionId: string, admissionNo: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${admissionNo}, 'Test', '2015-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

async function assignStudent(institutionId: string, studentId: string, routeId: string, stopId: string, assignedBy: string): Promise<void> {
  await sql`
    insert into public.transport_assignments (institution_id, student_id, route_id, stop_id, assigned_by)
    values (${institutionId}, ${studentId}, ${routeId}, ${stopId}, ${assignedBy})
  `;
}

async function linkGuardian(institutionId: string, guardianId: string, studentId: string, portalAccess = true): Promise<void> {
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, portal_access)
    values (${institutionId}, ${guardianId}, ${studentId}, 'mother', ${portalAccess})
  `;
}

async function guardianId(inst: TestInstitution): Promise<string> {
  const [row] = await sql`select guardian_id from public.memberships where institution_id = ${inst.institutionId} and role = 'guardian'`;
  return row.guardian_id as string;
}

describe("transport queries (M13-T9)", () => {
  it("routes: counts match assignments and stops are ordered by seq with x/y", async () => {
    const inst = await createTestInstitution("tr-q-routes");
    try {
      const vehicleId = await createVehicle(inst.institutionId, { registrationNo: "MH12AB1234", capacity: 2, driverName: "Ravi" });
      const routeId = await createRoute(inst.institutionId, vehicleId, "Route 1");
      // Inserted out of seq order to prove the query sorts, not the insert order.
      const stop2 = await createStop(inst.institutionId, routeId, 2, { name: "Stop B", mapX: 40, mapY: 60 });
      const stop1 = await createStop(inst.institutionId, routeId, 1, { name: "Stop A", mapX: 20, mapY: 30 });
      const studentA = await createStudent(inst.institutionId, "ADM-A-001");
      const studentB = await createStudent(inst.institutionId, "ADM-B-001");
      await assignStudent(inst.institutionId, studentA, routeId, stop1, inst.users.admin.id);
      await assignStudent(inst.institutionId, studentB, routeId, stop2, inst.users.admin.id);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const routes = await transportRoutes(ctx);
        expect(routes).toHaveLength(1);
        const route = routes[0];
        expect(route.id).toBe(routeId);
        expect(route.vehicle).toBe("MH12AB1234");
        expect(route.driver).toBe("Ravi");
        expect(route.capacity).toBe(2);
        expect(route.assigned).toBe(2);
        expect(route.stops).toMatchObject([
          { name: "Stop A", eta: "07:00", students: 1, x: 20, y: 30 },
          { name: "Stop B", eta: "07:00", students: 1, x: 40, y: 60 },
        ]);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("routes: a route with no vehicle reports vehicle/driver '' and capacity 0", async () => {
    const inst = await createTestInstitution("tr-q-novehicle");
    try {
      const routeId = await createRoute(inst.institutionId, null, "No Vehicle Route");
      await createStop(inst.institutionId, routeId, 1);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      try {
        const routes = await transportRoutes(ctx);
        const route = routes.find((r) => r.id === routeId);
        expect(route?.vehicle).toBe("");
        expect(route?.driver).toBe("");
        expect(route?.capacity).toBe(0);
        expect(route?.assigned).toBe(0);
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("routes: teacher is forbidden (transport.manage required at the query gate)", async () => {
    const inst = await createTestInstitution("tr-q-forbidden");
    try {
      const result = await callAs(inst, "teacher", transportRoutesQuery, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("forStudent: a guardian sees her own child's stop", async () => {
    const inst = await createTestInstitution("tr-q-forstudent-own");
    try {
      const vehicleId = await createVehicle(inst.institutionId, { registrationNo: "MH14CD5678", driverName: "Suresh" });
      const routeId = await createRoute(inst.institutionId, vehicleId, "Route G");
      const stopId = await createStop(inst.institutionId, routeId, 1, { name: "Gate 3", pickupTime: "07:15" });
      const child = await createStudent(inst.institutionId, "ADM-CHILD-001");
      const gId = await guardianId(inst);
      await linkGuardian(inst.institutionId, gId, child, true);
      await assignStudent(inst.institutionId, child, routeId, stopId, inst.users.admin.id);

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const result = await transportForStudent(ctx, child);
        expect(result).toEqual({
          studentId: child,
          routeId,
          routeName: "Route G",
          vehicle: "MH14CD5678",
          driver: "Suresh",
          status: "on_time",
          stop: { name: "Gate 3", eta: "07:15" },
        });
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("forStudent: another family's child -> null (RLS hides the assignment row)", async () => {
    const inst = await createTestInstitution("tr-q-forstudent-other");
    try {
      const routeId = await createRoute(inst.institutionId, null, "Route H");
      const stopId = await createStop(inst.institutionId, routeId, 1);
      const otherChild = await createStudent(inst.institutionId, "ADM-OTHER-001");
      await assignStudent(inst.institutionId, otherChild, routeId, stopId, inst.users.admin.id);
      // No guardian_students link for this guardian -> own_student_ids is empty.

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const result = await transportForStudent(ctx, otherChild);
        expect(result).toBeNull();
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("forStudent: a teacher sees null for a student they do not teach", async () => {
    const inst = await createTestInstitution("tr-q-forstudent-teacher");
    try {
      const routeId = await createRoute(inst.institutionId, null, "Route I");
      const stopId = await createStop(inst.institutionId, routeId, 1);
      const student = await createStudent(inst.institutionId, "ADM-NOTTAUGHT-001");
      await assignStudent(inst.institutionId, student, routeId, stopId, inst.users.admin.id);

      const ctx = await buildContext(inst, "teacher");
      setActingClient(inst.clientAs("teacher"));
      try {
        const result = await transportForStudent(ctx, student);
        expect(result).toBeNull();
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("forStudent: no assignment at all -> null", async () => {
    const inst = await createTestInstitution("tr-q-forstudent-none");
    try {
      const student = await createStudent(inst.institutionId, "ADM-NONE-001");
      const gId = await guardianId(inst);
      await linkGuardian(inst.institutionId, gId, student, true);

      const ctx = await buildContext(inst, "guardian");
      setActingClient(inst.clientAs("guardian"));
      try {
        const result = await transportForStudent(ctx, student);
        expect(result).toBeNull();
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });
});
