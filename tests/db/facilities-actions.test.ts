import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { assignMaintenanceRequest, closeMaintenanceRequest, raiseMaintenanceRequest, upsertAsset } from "@/modules/facilities/actions";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M13-T5 — facilities.asset.upsert / maintenance.request / maintenance.assign
// / maintenance.close (M13-tasks.md Task 5 TEST FIRST list). Status machine
// and RLS are 0075's (guard_maintenance_requests_update, assets_tag_key).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("facilities actions (M13-T5)", () => {
  it("teacher raises a request, open with raised_by = teacher; admin assigns, closes; done is terminal", async () => {
    const inst = await createTestInstitution("facilities-actions-happy");

    const raised = await callAs(inst, "teacher", raiseMaintenanceRequest, { location: "Lab 2", issue: "Projector bulb blown." });
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const [row] = await sql`select status, raised_by from public.maintenance_requests where id = ${raised.data.id}`;
    expect(row.status).toBe("open");
    expect(row.raised_by).toBe(inst.users.teacher.id);

    const teacherAssign = await callAs(inst, "teacher", assignMaintenanceRequest, {
      requestId: raised.data.id,
      assigneeStaffId: crypto.randomUUID(),
    });
    // teacher lacks facilities.manage -> permission gate rejects (valid uuid so schema parse passes first)
    expect(teacherAssign.ok).toBe(false);
    if (!teacherAssign.ok) expect(teacherAssign.error.code).toBe("forbidden");

    const adminCtx = await buildContext(inst, "admin");
    const assigned = await callAs(inst, "admin", assignMaintenanceRequest, {
      requestId: raised.data.id,
      assigneeStaffId: adminCtx.membership.staffId as string,
    });
    expect(assigned.ok).toBe(true);
    if (!assigned.ok) return;
    expect(assigned.data.status).toBe("in_progress");

    const closed = await callAs(inst, "admin", closeMaintenanceRequest, { requestId: raised.data.id, resolutionNote: "Replaced bulb." });
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.data.status).toBe("done");

    const closedAgain = await callAs(inst, "admin", closeMaintenanceRequest, { requestId: raised.data.id });
    expect(closedAgain.ok).toBe(false);
    if (!closedAgain.ok) expect(closedAgain.error.code).toBe("invalid_state");

    await inst.cleanup();
  });

  it("duplicate asset tag -> conflict with fieldErrors.assetTag", async () => {
    const inst = await createTestInstitution("facilities-actions-dup-tag");

    const first = await callAs(inst, "admin", upsertAsset, { name: "Projector 1", category: "it", assetTag: "PROJ-01" });
    expect(first.ok).toBe(true);

    const second = await callAs(inst, "admin", upsertAsset, { name: "Projector 2", category: "it", assetTag: "PROJ-01" });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("conflict");
      expect(second.error.fieldErrors?.assetTag).toBeDefined();
    }

    await inst.cleanup();
  });

  it("assignee from another institution -> forbidden; unknown request id -> not_found", async () => {
    const instA = await createTestInstitution("facilities-actions-cross-a");
    const instB = await createTestInstitution("facilities-actions-cross-b");

    const raised = await callAs(instA, "teacher", raiseMaintenanceRequest, { location: "Hall", issue: "Leaking tap." });
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;

    const ctxB = await buildContext(instB, "admin");
    const crossAssign = await callAs(instA, "admin", assignMaintenanceRequest, {
      requestId: raised.data.id,
      assigneeStaffId: ctxB.membership.staffId as string,
    });
    expect(crossAssign.ok).toBe(false);
    if (!crossAssign.ok) expect(crossAssign.error.code).toBe("forbidden");

    const unknown = await callAs(instA, "admin", closeMaintenanceRequest, { requestId: crypto.randomUUID() });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("not_found");

    await instA.cleanup();
    await instB.cleanup();
  });
});
