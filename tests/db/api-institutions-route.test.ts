// M03-T4 — exercises the real exported POST of
// src/app/api/v1/institutions/route.ts against the live Supabase instance.
// Non-tenant route: brand-new auth users with zero memberships, same user
// creation pattern as tests/db/onboarding-rpc.test.ts, same bearer-dispatch
// pattern as tests/db/api-actions-route.test.ts.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as createInstitution } from "@/app/api/v1/institutions/route";
import { POST as dispatchAction } from "@/app/api/v1/actions/[name]/route";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

async function newSignedInUser(label: string) {
  const email = `api-institutions-${label}-${crypto.randomUUID()}@test.local`;
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("test user was not created");

  const client = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { data: signIn, error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError || !signIn.session) throw signInError ?? new Error("sign-in produced no session");

  return { userId: data.user.id, token: signIn.session.access_token };
}

// Same immutable-history cleanup as onboarding-rpc.test.ts.
async function cleanupInstitutions(institutionIds: string[]) {
  if (institutionIds.length === 0) return;
  await sql.begin(async (tx) => {
    await tx`select set_config('app.allow_reset', 'on', true)`;
    await tx`delete from public.audit_events where institution_id in ${sql(institutionIds)}`;
  });
  await sql`delete from public.terms where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.academic_years where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.memberships where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.staff where institution_id in ${sql(institutionIds)}`;
  await sql`delete from public.institutions where id in ${sql(institutionIds)}`;
}

const userIdsToDelete = new Set<string>();
const institutionIdsToDelete = new Set<string>();

afterEach(async () => {
  await cleanupInstitutions([...institutionIdsToDelete]);
  institutionIdsToDelete.clear();
  const admin = adminClient();
  for (const id of userIdsToDelete) {
    await admin.auth.admin.deleteUser(id);
  }
  userIdsToDelete.clear();
});

afterAll(async () => {
  await sql.end();
});

function institutionsRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/v1/institutions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/v1/institutions (M03-T4)", () => {
  it("brand-new user with bearer -> 200, then an owner-only action on that slug succeeds", async () => {
    const { userId, token } = await newSignedInUser("ok");
    userIdsToDelete.add(userId);
    const slug = `api-inst-ok-${crypto.randomUUID().slice(0, 8)}`;

    const res = await createInstitution(
      institutionsRequest(
        { input: { name: "API Institutions School", slug } },
        { authorization: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toMatchObject({ slug });
    institutionIdsToDelete.add(body.data.institutionId);

    const actionRes = await dispatchAction(
      new Request(`http://localhost/api/v1/actions/core.feature.set`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ institution: slug, input: { key: "teacher_ai_agent", enabled: false } }),
      }),
      { params: Promise.resolve({ name: "core.feature.set" }) },
    );
    expect(actionRes.status).toBe(200);
    const actionBody = await actionRes.json();
    expect(actionBody.ok).toBe(true);
  });

  it("no token -> 401 unauthenticated", async () => {
    const res = await createInstitution(
      institutionsRequest({ input: { name: "No Token School", slug: `api-inst-notoken-${crypto.randomUUID().slice(0, 8)}` } }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
  });

  it("reserved slug -> 422 validation_failed", async () => {
    const { userId, token } = await newSignedInUser("reserved");
    userIdsToDelete.add(userId);

    const res = await createInstitution(
      institutionsRequest(
        { input: { name: "Reserved Slug School", slug: "admin" } },
        { authorization: `Bearer ${token}` },
      ),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("duplicate slug -> 409 conflict", async () => {
    const { userId: userId1, token: token1 } = await newSignedInUser("dup1");
    const { userId: userId2, token: token2 } = await newSignedInUser("dup2");
    userIdsToDelete.add(userId1);
    userIdsToDelete.add(userId2);
    const slug = `api-inst-dup-${crypto.randomUUID().slice(0, 8)}`;

    const first = await createInstitution(
      institutionsRequest({ input: { name: "Dup School One", slug } }, { authorization: `Bearer ${token1}` }),
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    institutionIdsToDelete.add(firstBody.data.institutionId);

    const second = await createInstitution(
      institutionsRequest({ input: { name: "Dup School Two", slug } }, { authorization: `Bearer ${token2}` }),
    );
    expect(second.status).toBe(409);
    const secondBody = await second.json();
    expect(secondBody.error.code).toBe("conflict");
  });

  it("cross-site Origin -> 403 forbidden", async () => {
    const res = await createInstitution(
      institutionsRequest(
        { input: { name: "CSRF School", slug: `api-inst-csrf-${crypto.randomUUID().slice(0, 8)}` } },
        { origin: "https://evil.example" },
      ),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
  });
});
