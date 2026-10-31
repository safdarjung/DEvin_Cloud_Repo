import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { setMemberRole, setMemberStatus } from "@/modules/core/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

// M03-T7 — core.member.setRole / core.member.setStatus. The RLS policy
// (owner/principal/admin) and app.guard_membership_write (0033/0038 —
// self-edit, owner/principal escalation) are the real authorization
// boundary; these tests exercise the action wrapper (permission layer +
// mapSqlError's not_found/forbidden mapping).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function membershipIdFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const [row] = await sql`
    select id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users[role].id}
  `;
  return row.id as string;
}

describe("setMemberRole (M03-T7)", () => {
  it("principal moves a teacher to exam_controller", async () => {
    const inst = await createTestInstitution("member-manage-role-ok");
    const membershipId = await membershipIdFor(inst, "teacher");

    const result = await callAs(inst, "principal", setMemberRole, { membershipId, role: "exam_controller" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.role).toBe("exam_controller");
  });

  it("admin setting someone to owner is forbidden", async () => {
    const inst = await createTestInstitution("member-manage-role-owner");
    const membershipId = await membershipIdFor(inst, "teacher");

    const result = await callAs(inst, "admin", setMemberRole, { membershipId, role: "owner" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("admin editing their own membership is forbidden", async () => {
    const inst = await createTestInstitution("member-manage-role-self");
    const membershipId = await membershipIdFor(inst, "admin");

    const result = await callAs(inst, "admin", setMemberRole, { membershipId, role: "teacher" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("a teacher without member.manage is forbidden", async () => {
    const inst = await createTestInstitution("member-manage-role-teacher");
    const membershipId = await membershipIdFor(inst, "accountant");

    const result = await callAs(inst, "teacher", setMemberRole, { membershipId, role: "exam_controller" });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });
});

describe("setMemberStatus (M03-T7)", () => {
  it("disabling a member drops the active-membership row getTenantContext relies on", async () => {
    const inst = await createTestInstitution("member-manage-status-disable");
    const membershipId = await membershipIdFor(inst, "teacher");

    const result = await callAs(inst, "owner", setMemberStatus, { membershipId, status: "disabled" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("disabled");

    // Same clause getTenantContext (src/lib/auth/context.ts) joins on —
    // `status = 'active'` — so a disabled member's portal lookup resolves
    // to nothing and surfaces as 404 there, without needing to drive
    // next/navigation's notFound() from this DB-only test.
    const [row] = await sql`
      select id from public.memberships
      where id = ${membershipId} and status = 'active'
    `;
    expect(row).toBeUndefined();
  });
});
