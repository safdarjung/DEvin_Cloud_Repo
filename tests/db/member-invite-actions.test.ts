import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { inviteMember, revokeInvite } from "@/modules/core/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// M03-T5 — core.member.invite / core.member.revokeInvite. invite_member/
// revoke_invitation (0079) are the real authorization/escalation boundary;
// these tests exercise the action wrapper (permission layer + mapSqlError).
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function createUnlinkedStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Unlinked Staff', 'Teacher')
    returning id
  `;
  return row.id as string;
}

describe("inviteMember / revokeInvite (M03-T5)", () => {
  it("admin invites a teacher and gets a 64-hex token", async () => {
    const inst = await createTestInstitution("member-invite-ok");
    const staffId = await createUnlinkedStaff(inst.institutionId);

    const result = await callAs(inst, "admin", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@test.coolskool.test`,
      role: "teacher",
      staffId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.invitationId).toBeTruthy();
    expect(result.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data.delivery).toBe("simulated");
  });

  it("a teacher without member.manage is forbidden", async () => {
    const inst = await createTestInstitution("member-invite-forbidden");
    const staffId = await createUnlinkedStaff(inst.institutionId);

    const result = await callAs(inst, "teacher", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@test.coolskool.test`,
      role: "teacher",
      staffId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("admin inviting an owner is forbidden at the SQL layer", async () => {
    const inst = await createTestInstitution("member-invite-owner");
    const staffId = await createUnlinkedStaff(inst.institutionId);

    const result = await callAs(inst, "admin", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@test.coolskool.test`,
      role: "owner",
      staffId,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("forbidden");
  });

  it("revokes an invitation, and revoking it again is invalid_state", async () => {
    const inst = await createTestInstitution("member-invite-revoke");
    const staffId = await createUnlinkedStaff(inst.institutionId);

    const invited = await callAs(inst, "owner", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@test.coolskool.test`,
      role: "teacher",
      staffId,
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const revoked = await callAs(inst, "owner", revokeInvite, { invitationId: invited.data.invitationId });
    expect(revoked.ok).toBe(true);

    const revokedAgain = await callAs(inst, "owner", revokeInvite, { invitationId: invited.data.invitationId });
    expect(revokedAgain.ok).toBe(false);
    if (revokedAgain.ok) return;
    expect(revokedAgain.error.code).toBe("invalid_state");
  });
});
