// M13-T8 — src/modules/facilities/queries.ts via the query-defs wrapper
// (callAs — real permission guard + real RLS), same pattern as
// tests/db/audit-list-query.test.ts. Fixtures write assets/
// maintenance_requests straight via sql (no facilities actions.ts yet —
// T3's own packet), mirroring tests/db/operations-rls.test.ts's local
// helpers.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { facilitiesAssetsQuery, facilitiesMaintenanceRequestsQuery } from "@/modules/facilities/query-defs";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type FixtureRole } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function staffIdFor(institutionId: string, role: FixtureRole): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = ${role}`;
  return row.staff_id as string;
}

async function createRoom(institutionId: string, name = "Room A"): Promise<string> {
  const [row] = await sql`
    insert into public.rooms (institution_id, name, capacity) values (${institutionId}, ${name}, 30) returning id
  `;
  return row.id as string;
}

async function createAsset(
  institutionId: string,
  overrides: Partial<{ name: string; roomId: string | null; location: string | null }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.assets (institution_id, name, category, room_id, location)
    values (${institutionId}, ${overrides.name ?? "Projector"}, 'electrical', ${overrides.roomId ?? null}, ${overrides.location ?? null})
    returning id
  `;
  return row.id as string;
}

async function createMaintenanceRequest(
  institutionId: string,
  raisedByUserId: string,
  overrides: Partial<{
    assetId: string | null;
    location: string | null;
    issue: string;
    priority: string;
    status: string;
    assigneeStaffId: string | null;
    raisedAt: string;
  }> = {},
): Promise<string> {
  const [row] = await sql`
    insert into public.maintenance_requests
      (institution_id, asset_id, location, issue, priority, status, raised_by, assignee_staff_id, raised_at)
    values (
      ${institutionId}, ${overrides.assetId ?? null}, ${overrides.location ?? null}, ${overrides.issue ?? "Broken"},
      ${overrides.priority ?? "medium"}, ${overrides.status ?? "open"}, ${raisedByUserId},
      ${overrides.assigneeStaffId ?? null}, ${overrides.raisedAt ?? new Date().toISOString()}
    )
    returning id
  `;
  return row.id as string;
}

describe("facilities queries (M13-T8)", () => {
  it("admin sees all requests, ordered priority high->low then raised_at desc, with asset/room/assignee resolved", async () => {
    const inst = await createTestInstitution("fac-q-admin-all");
    try {
      const roomId = await createRoom(inst.institutionId, "Lab 1");
      const assetId = await createAsset(inst.institutionId, { name: "Lab Kit", roomId });
      const accountantStaffId = await staffIdFor(inst.institutionId, "accountant");

      await createMaintenanceRequest(inst.institutionId, inst.users.teacher.id, {
        assetId,
        priority: "low",
        issue: "Low priority",
        raisedAt: "2026-11-01T10:00:00Z",
      });
      await createMaintenanceRequest(inst.institutionId, inst.users.admin.id, {
        assetId,
        priority: "high",
        issue: "High priority",
        status: "in_progress",
        assigneeStaffId: accountantStaffId,
        raisedAt: "2026-11-01T09:00:00Z",
      });
      await createMaintenanceRequest(inst.institutionId, inst.users.admin.id, {
        location: "Gate 1",
        priority: "high",
        issue: "High priority, later",
        raisedAt: "2026-11-01T11:00:00Z",
      });

      const result = await callAs(inst, "admin", facilitiesMaintenanceRequestsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(3);
      // high (later raised_at) > high (earlier) > low
      expect(result.data.map((r) => r.issue)).toEqual(["High priority, later", "High priority", "Low priority"]);

      const assigned = result.data.find((r) => r.issue === "High priority");
      expect(assigned?.asset).toBe("Lab Kit");
      expect(assigned?.location).toBe("Lab 1"); // no request-level location -> asset's room
      expect(assigned?.assignee).toBe("Test accountant"); // admin's own staff RLS sees every staff row
      expect(assigned?.raised_at).toBe("2026-11-01");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher sees only their own requests, and staff RLS hides another staff member's name from the assignee field", async () => {
    const inst = await createTestInstitution("fac-q-teacher-own");
    try {
      const accountantStaffId = await staffIdFor(inst.institutionId, "accountant");
      await createMaintenanceRequest(inst.institutionId, inst.users.admin.id, {
        location: "Admin's own",
        issue: "Not mine",
      });
      await createMaintenanceRequest(inst.institutionId, inst.users.teacher.id, {
        location: "Mine",
        issue: "Mine",
        status: "in_progress",
        assigneeStaffId: accountantStaffId,
      });

      const result = await callAs(inst, "teacher", facilitiesMaintenanceRequestsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].issue).toBe("Mine");
      // teacher's staff RLS (0004: owner/principal/admin/accountant/exam_controller + own row)
      // does not include "see any teacher's assignee" — the accountant row is hidden, so null.
      expect(result.data[0].assignee).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("an asset-less request shows its own location and asset \"General\"", async () => {
    const inst = await createTestInstitution("fac-q-asset-less");
    try {
      await createMaintenanceRequest(inst.institutionId, inst.users.admin.id, {
        location: "Playground gate",
        issue: "Broken latch",
      });

      const result = await callAs(inst, "admin", facilitiesMaintenanceRequestsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({ asset: "General", location: "Playground gate" });
    } finally {
      await inst.cleanup();
    }
  });

  it("status filter works", async () => {
    const inst = await createTestInstitution("fac-q-status-filter");
    try {
      await createMaintenanceRequest(inst.institutionId, inst.users.admin.id, { location: "A", issue: "Open one", status: "open" });
      await createMaintenanceRequest(inst.institutionId, inst.users.admin.id, { location: "B", issue: "Done one", status: "done" });

      const result = await callAs(inst, "admin", facilitiesMaintenanceRequestsQuery, { status: "done" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toHaveLength(1);
      expect(result.data[0].issue).toBe("Done one");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian has no maintenance.request permission -> forbidden", async () => {
    const inst = await createTestInstitution("fac-q-guardian-forbidden");
    try {
      const result = await callAs(inst, "guardian", facilitiesMaintenanceRequestsQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });

  it("facilities.assets lists assets with room name resolved and status filter applied", async () => {
    const inst = await createTestInstitution("fac-q-assets");
    try {
      const roomId = await createRoom(inst.institutionId, "Hall");
      await createAsset(inst.institutionId, { name: "Sound System", roomId });
      await sql`update public.assets set status = 'under_repair' where institution_id = ${inst.institutionId}`;
      await createAsset(inst.institutionId, { name: "Spare Mic", location: "Store room" });

      const all = await callAs(inst, "admin", facilitiesAssetsQuery, {});
      expect(all.ok).toBe(true);
      if (!all.ok) return;
      expect(all.data).toHaveLength(2);
      const soundSystem = all.data.find((a) => a.name === "Sound System");
      expect(soundSystem).toMatchObject({ room: "Hall", status: "under_repair", location: null });
      const spareMic = all.data.find((a) => a.name === "Spare Mic");
      expect(spareMic).toMatchObject({ room: null, location: "Store room" });

      const filtered = await callAs(inst, "admin", facilitiesAssetsQuery, { status: "under_repair" });
      expect(filtered.ok).toBe(true);
      if (!filtered.ok) return;
      expect(filtered.data).toHaveLength(1);
      expect(filtered.data[0].name).toBe("Sound System");
    } finally {
      await inst.cleanup();
    }
  });
});
