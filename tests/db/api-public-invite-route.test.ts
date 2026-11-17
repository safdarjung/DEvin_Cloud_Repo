import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// POST /api/public/invite: a person with an invite link and no account sets a password and joins.
process.env.CRON_SECRET ??= "test-cron-secret-for-invite-route";
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as join } from "@/app/api/public/invite/route";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const admin = () => createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
const PASSWORD = "long-enough-pass";

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

function request(body: unknown, ip: string = crypto.randomUUID()): Request {
  return new Request("http://localhost/api/public/invite", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

async function invite(fixture: Awaited<ReturnType<typeof createTestInstitution>>, email: string): Promise<string> {
  const [staff] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${fixture.institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Invited Teacher', 'Teacher') returning id`;
  const { data, error } = await fixture.clientAs("owner").rpc("invite_member", {
    p_institution_id: fixture.institutionId,
    p_email: email,
    p_role: "teacher",
    p_staff_id: staff.id,
  });
  if (error || !data?.[0]) throw error ?? new Error("invite_member returned no row");
  return data[0].token as string;
}

describe("POST /api/public/invite", () => {
  it("a valid token creates the account, joins the school and points at it; the token cannot be reused", async () => {
    const fixture = await createTestInstitution("join-ok");
    const email = `join-${crypto.randomUUID()}@test.local`;
    try {
      const token = await invite(fixture, email);
      const res = await join(request({ token, fullName: "Meera Iyer", password: PASSWORD }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, data: { redirectTo: `/${fixture.slug}` } });

      const [row] = await sql`
        select m.role, m.status from public.memberships m join auth.users u on u.id = m.user_id
        where u.email = ${email} and m.institution_id = ${fixture.institutionId}`;
      expect(row).toEqual({ role: "teacher", status: "active" });

      const again = await join(request({ token, fullName: "Meera Iyer", password: PASSWORD }));
      expect(again.status).toBe(403);
    } finally {
      const [u] = await sql`select id from auth.users where email = ${email}`;
      if (u) await admin().auth.admin.deleteUser(u.id);
      await fixture.cleanup();
    }
  });

  it("an unknown token creates no account", async () => {
    const res = await join(request({ token: "0".repeat(64), fullName: "Nobody Here", password: PASSWORD }));
    expect(res.status).toBe(403);
  });

  it("an email that already has an account gets a sign-in hint and the invite stays open", async () => {
    const fixture = await createTestInstitution("join-exists");
    const email = `exists-${crypto.randomUUID()}@test.local`;
    const created = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    try {
      const token = await invite(fixture, email);
      const res = await join(request({ token, fullName: "Existing User", password: "another-pass-1" }));
      expect(res.status).toBe(409);
      const [inv] = await sql`select accepted_at from public.invitations where institution_id = ${fixture.institutionId}`;
      expect(inv.accepted_at).toBeNull();
    } finally {
      if (created.data.user) await admin().auth.admin.deleteUser(created.data.user.id);
      await fixture.cleanup();
    }
  });

  it("wrong tokens are limited per client, but a valid token from that same client still works", async () => {
    const ip = crypto.randomUUID();
    const wrong = () => request({ token: crypto.randomUUID().replaceAll("-", "").repeat(2), fullName: "Nobody", password: PASSWORD }, ip);
    for (let i = 0; i < 5; i++) expect((await join(wrong())).status).toBe(403);
    expect((await join(wrong())).status).toBe(429);

    const fixture = await createTestInstitution("join-limit");
    const email = `limit-${crypto.randomUUID()}@test.local`;
    try {
      const token = await invite(fixture, email);
      const res = await join(request({ token, fullName: "Still Fine", password: PASSWORD }, ip));
      expect(res.status).toBe(200);
    } finally {
      const [u] = await sql`select id from auth.users where email = ${email}`;
      if (u) await admin().auth.admin.deleteUser(u.id);
      await fixture.cleanup();
    }
  });
});
