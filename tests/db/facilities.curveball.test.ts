// Curveball sweep (facilities): reassigning a done request, parallel close, foreign asset, Zod edges, roles.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { assignMaintenanceRequest, closeMaintenanceRequest, raiseMaintenanceRequest, upsertAsset } from "@/modules/facilities/actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let a: TestInstitution;
let b: TestInstitution;
let adminStaff: string;

async function raised(): Promise<string> {
  const r = await callAs(a, "teacher", raiseMaintenanceRequest, { location: "Room 4", issue: "Fan not working" });
  if (!r.ok) throw new Error(r.error.code);
  return r.data.id;
}

beforeAll(async () => {
  a = await createTestInstitution("fac-cb");
  b = await createTestInstitution("fac-cb-x");
  adminStaff = (await buildContext(a, "admin")).membership.staffId as string;
});

afterAll(async () => {
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("facilities curveballs", () => {
  it("a done request cannot be reassigned (invalid_state) and stays done", async () => {
    const id = await raised();
    expect((await callAs(a, "admin", assignMaintenanceRequest, { requestId: id, assigneeStaffId: adminStaff })).ok).toBe(true);
    expect((await callAs(a, "admin", closeMaintenanceRequest, { requestId: id })).ok).toBe(true);
    const r = await callAs(a, "principal", assignMaintenanceRequest, { requestId: id, assigneeStaffId: adminStaff });
    expect(r.ok ? null : r.error.code).toBe("invalid_state");
    const [row] = await sql`select status from public.maintenance_requests where id = ${id}`;
    expect(row.status).toBe("done");
  });

  it("two parallel closes: exactly one succeeds", async () => {
    const id = await raised();
    await callAs(a, "admin", assignMaintenanceRequest, { requestId: id, assigneeStaffId: adminStaff });
    const rs = await Promise.all([
      callAs(a, "admin", closeMaintenanceRequest, { requestId: id, resolutionNote: "Fixed" }),
      callAs(a, "owner", closeMaintenanceRequest, { requestId: id, resolutionNote: "Also fixed" }),
    ]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.map((r) => (r.ok ? "ok" : r.error.code))).not.toContain("internal");
  });

  it("raising against another school's asset is refused, not internal", async () => {
    const theirs = await callAs(b, "admin", upsertAsset, { name: "Projector", category: "it" });
    if (!theirs.ok) throw new Error(JSON.stringify(theirs.error));
    const r = await callAs(a, "teacher", raiseMaintenanceRequest, { assetId: theirs.data.id, issue: "Broken" });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.code).not.toBe("internal");
  });

  it("neither asset nor location, blank issue, unknown priority → validation_failed", async () => {
    const neither = await callAs(a, "teacher", raiseMaintenanceRequest, { issue: "Broken" });
    expect(neither.ok ? null : neither.error.code).toBe("validation_failed");
    const blank = await callAs(a, "teacher", raiseMaintenanceRequest, { location: "Room 1", issue: "   " });
    expect(blank.ok ? null : blank.error.fieldErrors?.issue).toBeTruthy();
    const prio = await callAs(a, "teacher", raiseMaintenanceRequest, { location: "Room 1", issue: "x", priority: "asap" });
    expect(prio.ok ? null : prio.error.fieldErrors?.priority).toBeTruthy();
  });

  it("student and guardian cannot raise; another school's request cannot be closed (not_found)", async () => {
    for (const role of ["student", "guardian"] as const) {
      const r = await callAs(a, role, raiseMaintenanceRequest, { location: "Room 1", issue: "Leak" });
      expect(r.ok ? null : r.error.code).toBe("forbidden");
    }
    const theirs = await callAs(b, "teacher", raiseMaintenanceRequest, { location: "Hall", issue: "Leak" });
    if (!theirs.ok) throw new Error(theirs.error.code);
    const cross = await callAs(a, "admin", closeMaintenanceRequest, { requestId: theirs.data.id });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
  });
});
