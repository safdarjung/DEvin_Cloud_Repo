import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

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

// M17-T3 (D42) — invite email via Resend. `vitest.config.mts` deletes
// RESEND_API_KEY after loading .env.local; passthrough spy per rulings so
// the real supabase/postgres fetch calls this test also makes still work.
function stubResendFetch(responseInit?: { status?: number; id?: string }) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://api.resend.com/")) return real(input as Parameters<typeof fetch>[0], init);
    if (responseInit?.status && responseInit.status >= 300) {
      return Promise.resolve(new Response("boom", { status: responseInit.status }));
    }
    return Promise.resolve(Response.json({ id: responseInit?.id ?? "re_1" }));
  });
}

describe("inviteMember email delivery (M17-T3)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("key + APP_URL set -> sent, one Resend call, text has school/role/link, audit has delivery no address", async () => {
    const inst = await createTestInstitution("m17t3-sent");
    const staffId = await createUnlinkedStaff(inst.institutionId);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("APP_URL", "https://app.coolskool.test/");
    const fetchSpy = stubResendFetch({ id: "re_1" });

    const email = `invitee-${crypto.randomUUID()}@school-fixture.in`;
    const result = await callAs(inst, "admin", inviteMember, { email, role: "teacher", staffId });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.delivery).toBe("sent");

    const resendCalls = fetchSpy.mock.calls.filter(([i]) =>
      String(i instanceof Request ? i.url : i).startsWith("https://api.resend.com/"),
    );
    expect(resendCalls).toHaveLength(1);
    const [, init] = resendCalls[0] as [unknown, RequestInit];
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(`invite:${result.data.invitationId}`);
    const body = JSON.parse(init.body as string);
    expect(body.to).toEqual([email]);
    expect(body.text).toContain("m17t3-sent");
    expect(body.text).toContain("teacher");
    expect(body.text).toContain(`/invite#token=${result.data.token}`);

    const [auditRow] = await sql`
      select after from public.audit_events
      where entity_id = ${result.data.invitationId} and action = 'core.member.invite'
    `;
    expect(auditRow.after).toMatchObject({ role: "teacher", delivery: "sent" });
    expect(JSON.stringify(auditRow.after)).not.toContain(email);
  });

  it("key unset -> simulated, no Resend call", async () => {
    const inst = await createTestInstitution("m17t3-nokey");
    const staffId = await createUnlinkedStaff(inst.institutionId);
    const fetchSpy = stubResendFetch();

    const result = await callAs(inst, "admin", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@school-fixture.in`,
      role: "teacher",
      staffId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.delivery).toBe("simulated");
    expect(fetchSpy.mock.calls.some(([i]) => String(i instanceof Request ? i.url : i).startsWith("https://api.resend.com/"))).toBe(
      false,
    );
  });

  it("key set but APP_URL unset -> simulated, no Resend call", async () => {
    const inst = await createTestInstitution("m17t3-noappurl");
    const staffId = await createUnlinkedStaff(inst.institutionId);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("APP_URL", "");
    const fetchSpy = stubResendFetch();

    const result = await callAs(inst, "admin", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@school-fixture.in`,
      role: "teacher",
      staffId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.delivery).toBe("simulated");
    expect(fetchSpy.mock.calls.some(([i]) => String(i instanceof Request ? i.url : i).startsWith("https://api.resend.com/"))).toBe(
      false,
    );
  });

  it("Resend 500 -> ok:true, delivery:failed, invitation row still exists", async () => {
    const inst = await createTestInstitution("m17t3-failed");
    const staffId = await createUnlinkedStaff(inst.institutionId);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("APP_URL", "https://app.coolskool.test");
    stubResendFetch({ status: 500 });

    const result = await callAs(inst, "admin", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@school-fixture.in`,
      role: "teacher",
      staffId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.delivery).toBe("failed");

    const [invitation] = await sql`select id from public.invitations where id = ${result.data.invitationId}`;
    expect(invitation).toBeTruthy();
  });

  it("existing reserved-domain invite still reports simulated with key+APP_URL set (no bounce)", async () => {
    const inst = await createTestInstitution("m17t3-reserved");
    const staffId = await createUnlinkedStaff(inst.institutionId);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("APP_URL", "https://app.coolskool.test");
    const fetchSpy = stubResendFetch();

    const result = await callAs(inst, "admin", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@test.coolskool.test`,
      role: "teacher",
      staffId,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.delivery).toBe("simulated");
    expect(fetchSpy.mock.calls.some(([i]) => String(i instanceof Request ? i.url : i).startsWith("https://api.resend.com/"))).toBe(
      false,
    );
  });
});
