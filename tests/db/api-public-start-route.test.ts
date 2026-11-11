import { createHash } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// F18 §H — the real exported POST of src/app/api/public/start/route.ts against
// local Supabase. Cookies go to a throwaway jar; each request gets its own
// forwarded IP and bad codes are random, so the SQL rate limit (0127
// school_start_attempts) only bites in the tests that aim for it.
process.env.CRON_SECRET ??= "test-cron-secret-for-start-route";
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
// Real server client unless a test forces it to throw (a throw after createUser).
const failCreateClient = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/supabase/server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/supabase/server")>();
  return {
    ...real,
    createClient: async () => {
      if (failCreateClient.on) throw new Error("forced createClient failure");
      return real.createClient();
    },
  };
});

import { POST as start } from "@/app/api/public/start/route";
import { closeInviteCodesHelper, mintInviteCode } from "../helpers/invite-codes";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const admin = () => createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
const userIds = new Set<string>();
const slugs = new Set<string>();

const hashOf = (code: string) => createHash("sha256").update(code).digest("hex");
const newEmail = (label: string) => `start-${label}-${crypto.randomUUID()}@test.local`;
const newSlug = (label: string) => `start-${label}-${crypto.randomUUID().slice(0, 8)}`;
const badCode = () => `NOT-A-CODE-${crypto.randomUUID()}`;
const RATE_LIMITED = { ok: false, error: { code: "rate_limited", message: "Too many attempts. Try again later." } };

function startRequest(body: Record<string, unknown>, ip = crypto.randomUUID(), headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/public/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
    body: JSON.stringify(body),
  });
}

function startBody(code: string, overrides: Record<string, unknown> = {}) {
  const slug = newSlug("ok");
  slugs.add(slug);
  return { code, schoolName: "Start Route School", slug, ownerName: "Asha Rao", email: newEmail("ok"), password: "long-enough-pass", ...overrides };
}

async function authUserIds(email: string): Promise<string[]> {
  return (await sql`select id from auth.users where email = ${email}`).map((r) => r.id as string);
}

afterEach(async () => {
  for (const slug of slugs) {
    const [inst] = await sql`select id from public.institutions where slug = ${slug}`;
    if (!inst) continue;
    await sql`update public.institutions set is_demo = true where id = ${inst.id}`;
    await sql`select app.demo_reset(${inst.id}::uuid)`;
    await sql`delete from public.institutions where id = ${inst.id}`;
  }
  slugs.clear();
  for (const id of userIds) await admin().auth.admin.deleteUser(id);
  userIds.clear();
});

afterAll(async () => {
  await sql.end();
  await closeInviteCodesHelper();
});

describe("POST /api/public/start (F18 §H)", () => {
  it("a valid code creates the owner account and the school, then points at /<slug>/setup", async () => {
    const code = await mintInviteCode();
    const body = startBody(code.toLowerCase()); // typed in lower case: the route upper-cases it

    const res = await start(startRequest(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { redirectTo: `/${body.slug}/setup` } });

    const [userId] = await authUserIds(body.email);
    userIds.add(userId);
    const [membership] = await sql`
      select m.role, m.status, s.full_name from public.memberships m
      join public.institutions i on i.id = m.institution_id
      join public.staff s on s.id = m.staff_id
      where i.slug = ${body.slug} and m.user_id = ${userId}
    `;
    expect(membership).toEqual({ role: "owner", status: "active", full_name: "Asha Rao" });
    const [row] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(1);
  });

  it("bad codes create no user, and wrong/expired/revoked/used-up all look the same", async () => {
    const codes = [
      badCode(),
      await mintInviteCode({ expiresAt: new Date(Date.now() - 60_000) }),
      await mintInviteCode({ revoked: true }),
      await mintInviteCode({ maxUses: 1, usedCount: 1 }),
    ];
    const bodies = [];
    for (const code of codes) {
      const body = startBody(code);
      const res = await start(startRequest(body));
      expect(res.status).toBe(403);
      bodies.push(await res.json());
      expect(await authUserIds(body.email)).toEqual([]);
    }
    for (const b of bodies) expect(b).toEqual({ ok: false, error: { code: "forbidden", message: "This invite code is not valid." } });
  });

  it("a failure after the user was created removes that user and leaves the code unspent", async () => {
    const takenSlug = newSlug("taken");
    const first = startBody(await mintInviteCode(), { slug: takenSlug });
    slugs.add(takenSlug);
    expect((await start(startRequest(first))).status).toBe(200);
    userIds.add((await authUserIds(first.email))[0]);

    const code = await mintInviteCode();
    const second = startBody(code, { slug: takenSlug });
    const res = await start(startRequest(second));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
    expect(await authUserIds(second.email)).toEqual([]);
    const [row] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(0);
  });

  it("a throw after the user was created removes that user and leaves the code unspent", async () => {
    const code = await mintInviteCode();
    const body = startBody(code);
    failCreateClient.on = true;
    try {
      const res = await start(startRequest(body));
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ ok: false, error: { code: "internal", message: "Something went wrong. Please try again." } });
    } finally {
      failCreateClient.on = false;
    }
    expect(await authUserIds(body.email)).toEqual([]);
    const [row] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(0);
  });

  it("a code bound to another email looks like a bad code: no createUser, so an existing account is never revealed", async () => {
    const existing = newEmail("existing-bound");
    const { data } = await admin().auth.admin.createUser({ email: existing, password: "their-own-password", email_confirm: true });
    userIds.add(data.user!.id);
    const ownerEmail = newEmail("bound");
    const code = await mintInviteCode({ email: ownerEmail });

    const stranger = newEmail("stranger");
    for (const email of [existing, stranger]) {
      const body = startBody(code, { email });
      const res = await start(startRequest(body));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, error: { code: "forbidden", message: "This invite code is not valid." } });
    }
    expect(await authUserIds(existing)).toEqual([data.user!.id]);
    expect(await authUserIds(stranger)).toEqual([]);
    const [unspent] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(unspent.used_count).toBe(0);

    // The owner's own address works, typed in any case.
    const right = startBody(code, { email: ownerEmail.toUpperCase() });
    expect((await start(startRequest(right))).status).toBe(200);
    const [ownerId] = await authUserIds(ownerEmail);
    userIds.add(ownerId);
    const [spent] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(spent.used_count).toBe(1);
  });

  it("an existing email gets the generic answer and that account is left untouched", async () => {
    const email = newEmail("existing");
    const { data } = await admin().auth.admin.createUser({ email, password: "their-own-password", email_confirm: true });
    userIds.add(data.user!.id);
    const code = await mintInviteCode();

    const body = startBody(code, { email });
    const res = await start(startRequest(body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "validation_failed",
      message: "We could not create an account with these details. If you already have one, contact us.",
    });
    expect(await authUserIds(email)).toEqual([data.user!.id]);
    expect(await sql`select 1 from public.institutions where slug = ${body.slug}`).toHaveLength(0);
    const [row] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(0);
  });

  it("refuses cross-site posts and invalid bodies", async () => {
    const crossSite = await start(startRequest(startBody("X"), undefined, { origin: "https://evil.example" }));
    expect(crossSite.status).toBe(403);

    const weak = await start(startRequest(startBody("X", { password: "short" })));
    expect(weak.status).toBe(400);
    expect((await weak.json()).error.fieldErrors.password).toBeDefined();
  });

  it("the 6th attempt from one client in 15 minutes gets 429 and no user, even on a fresh handler instance", async () => {
    const ip = crypto.randomUUID();
    for (let i = 0; i < 5; i++) expect((await start(startRequest(startBody(badCode()), ip))).status).toBe(403);

    vi.resetModules(); // a fresh module is a fresh serverless instance: no in-memory state survives
    const { POST: freshStart } = await import("@/app/api/public/start/route");
    const body = startBody(await mintInviteCode()); // even a valid code is refused once the client is limited
    const res = await freshStart(startRequest(body, ip));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(RATE_LIMITED);
    expect(await authUserIds(body.email)).toEqual([]);
  });

  it("30 attempts on one code in the hour, from any clients, limit that code for a new client", async () => {
    const code = await mintInviteCode();
    const rows = Array.from({ length: 30 }, () => ({ client_hash: hashOf(crypto.randomUUID()), code_hash: hashOf(code) }));
    await sql`insert into public.school_start_attempts ${sql(rows)}`;

    const body = startBody(code);
    const res = await start(startRequest(body));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(RATE_LIMITED);
    expect(await authUserIds(body.email)).toEqual([]);
    const [row] = await sql`select used_count from public.platform_invite_codes where code_hash = ${hashOf(code)}`;
    expect(row.used_count).toBe(0);
    await sql`delete from public.school_start_attempts where code_hash = ${hashOf(code)}`;
  });
});
