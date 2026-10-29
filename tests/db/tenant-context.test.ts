import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "@/lib/auth/types";

// getTenantContext only talks to `@/lib/supabase/server`; mocking that one
// module lets this test drive a REAL signed-in Supabase session (so RLS
// evaluates auth.uid() for real) without needing Next's request-scoped
// `cookies()`, which throws outside an actual Next.js request (confirmed
// empirically — plain `next/headers` cookies() is unusable here).
let claimsForA: { sub: string } | null = null;
let clientA: ReturnType<typeof createSupabaseClient>;

vi.mock("@/lib/supabase/server", () => ({
  getClaims: async () => claimsForA,
  createClient: async () => clientA,
}));

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

const instA = "00000000-0000-0000-0000-00000000d001";
const instB = "00000000-0000-0000-0000-00000000d002";
const EMAIL_A = `tenant-ctx-a-${crypto.randomUUID()}@test.local`;
const PASSWORD = "correct-horse-battery-staple";

let userAId: string;

describe("getTenantContext (T-007 AC2)", () => {
  beforeAll(async () => {
    const { data, error } = await adminClient().auth.admin.createUser({
      email: EMAIL_A,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error("test user was not created");
    userAId = data.user.id;

    await sql`
      insert into public.institutions (id, slug, name) values
        (${instA}, 'tenant-ctx-a', 'Tenant Ctx A'),
        (${instB}, 'tenant-ctx-b', 'Tenant Ctx B')
    `;
    const [staffA] = await sql`
      insert into public.staff (institution_id, employee_no, full_name, designation)
      values (${instA}, 'EMP-A', 'Staff A', 'Owner')
      returning id
    `;
    await sql`
      insert into public.memberships (institution_id, user_id, role, staff_id)
      values (${instA}, ${userAId}, 'owner', ${staffA.id})
    `;

    clientA = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    );
    const { data: signIn, error: signInError } = await clientA.auth.signInWithPassword({
      email: EMAIL_A,
      password: PASSWORD,
    });
    if (signInError || !signIn.session) throw signInError ?? new Error("sign-in failed");

    const { data: claimsData } = await clientA.auth.getClaims();
    claimsForA = claimsData ? { sub: claimsData.claims.sub } : null;
  });

  afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.allow_reset', 'on', true)`;
      await tx`delete from public.audit_events where institution_id in (${instA}, ${instB})`;
    });
    await sql`delete from public.memberships where institution_id in (${instA}, ${instB})`;
    await sql`delete from public.staff where institution_id in (${instA}, ${instB})`;
    await sql`delete from public.institutions where id in (${instA}, ${instB})`;
    await adminClient().auth.admin.deleteUser(userAId);
    await sql.end();
  });

  it("returns the real context for the member's own institution", async () => {
    const { getTenantContext } = await import("@/lib/auth/context");
    const ctx: TenantContext = await getTenantContext("tenant-ctx-a");

    expect(ctx.institution.slug).toBe("tenant-ctx-a");
    expect(ctx.membership.role).toBe("owner");
    expect(ctx.user.id).toBe(userAId);
  });

  it("throws Next's notFound() signal for an institution the caller is not a member of", async () => {
    const { getTenantContext } = await import("@/lib/auth/context");

    await expect(getTenantContext("tenant-ctx-b")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK"),
    });
  });

  it("throws Next's notFound() signal for a slug that doesn't exist at all", async () => {
    const { getTenantContext } = await import("@/lib/auth/context");

    await expect(getTenantContext("does-not-exist")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK"),
    });
  });
});
