// M03-T6 — exercises the real exported POST of
// src/app/api/v1/invitations/accept/route.ts against the live Supabase
// instance. Non-tenant route: an invited user with zero memberships claims
// one with the invite token, same bearer-dispatch pattern as
// tests/db/api-institutions-route.test.ts. The token itself comes from a
// direct `invite_member` RPC call on the fixture owner's real signed-in
// client (tests/helpers/roles.ts), not through the action dispatcher —
// this file never mocks @/lib/supabase/server, so the route under test
// keeps using the real module.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as acceptInvitation } from "@/app/api/v1/invitations/accept/route";
import { POST as dispatchQuery } from "@/app/api/v1/query/[name]/route";
import { createTestInstitution, closeRolesHelper } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

async function newInvitedUser(email: string) {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("invited test user was not created");

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError || !signIn.session) throw signInError ?? new Error("sign-in produced no session");

  return { userId: data.user.id, token: signIn.session.access_token };
}

async function createUnlinkedStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Unlinked Staff', 'Teacher')
    returning id
  `;
  return row.id as string;
}

/** Owner directly RPCs invite_member (not through the action dispatcher) to mint a real token. */
async function inviteTeacher(
  fixture: Awaited<ReturnType<typeof createTestInstitution>>,
  email: string,
  staffId: string,
): Promise<string> {
  const { data, error } = await fixture.clientAs("owner").rpc("invite_member", {
    p_institution_id: fixture.institutionId,
    p_email: email,
    p_role: "teacher",
    p_staff_id: staffId,
  });
  if (error || !data || data.length === 0) throw error ?? new Error("invite_member returned no row");
  return data[0].token as string;
}

function acceptRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/invitations/accept", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("POST /api/v1/invitations/accept (M03-T6)", () => {
  it("invited user accepts with bearer -> 200, then a teacher-permitted query on that slug succeeds", async () => {
    const fixture = await createTestInstitution("accept-ok");
    const staffId = await createUnlinkedStaff(fixture.institutionId);
    const email = `invitee-accept-ok-${crypto.randomUUID()}@test.coolskool.test`;
    const token = await inviteTeacher(fixture, email, staffId);
    const invited = await newInvitedUser(email);

    try {
      const res = await acceptInvitation(
        acceptRequest({ input: { token } }, { authorization: `Bearer ${invited.token}` }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.data.membershipId).toBeTruthy();
      expect(body.data.institutionSlug).toBe(fixture.slug);

      const queryRes = await dispatchQuery(
        new Request("http://localhost/api/v1/query/notifications.unreadCount", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${invited.token}` },
          body: JSON.stringify({ institution: fixture.slug, input: {} }),
        }),
        { params: Promise.resolve({ name: "notifications.unreadCount" }) },
      );
      expect(queryRes.status).toBe(200);
      const queryBody = await queryRes.json();
      expect(queryBody.ok).toBe(true);
    } finally {
      await adminClient().auth.admin.deleteUser(invited.userId);
      await fixture.cleanup();
    }
  });

  it("reused token -> 409 invalid_state", async () => {
    const fixture = await createTestInstitution("accept-reuse");
    const staffId = await createUnlinkedStaff(fixture.institutionId);
    const email = `invitee-accept-reuse-${crypto.randomUUID()}@test.coolskool.test`;
    const token = await inviteTeacher(fixture, email, staffId);
    const invited = await newInvitedUser(email);

    try {
      const first = await acceptInvitation(
        acceptRequest({ input: { token } }, { authorization: `Bearer ${invited.token}` }),
      );
      expect(first.status).toBe(200);

      const second = await acceptInvitation(
        acceptRequest({ input: { token } }, { authorization: `Bearer ${invited.token}` }),
      );
      expect(second.status).toBe(409);
      const secondBody = await second.json();
      expect(secondBody.error.code).toBe("invalid_state");
    } finally {
      await adminClient().auth.admin.deleteUser(invited.userId);
      await fixture.cleanup();
    }
  });

  it("no token -> 401 unauthenticated", async () => {
    const res = await acceptInvitation(acceptRequest({ input: { token: "a".repeat(64) } }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });

  it("malformed token -> 422 validation_failed", async () => {
    const res = await acceptInvitation(acceptRequest({ input: { token: "not-a-valid-token" } }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });
});
