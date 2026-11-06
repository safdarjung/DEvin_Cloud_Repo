import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionResult } from "@/lib/actions/result";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import type { FixtureRole, TestInstitution } from "./roles";
import { setActingClient } from "./server-client-mock";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

/** Exported so test files can build a real per-role TenantContext for plain (non-action) query functions too — see server-client-mock.ts. */
export async function buildContext(fixture: TestInstitution, role: FixtureRole): Promise<TenantContext> {
  const [institution] = await sql`
    select id, slug, name, settings, ai_policy, is_demo
    from public.institutions where id = ${fixture.institutionId}
  `;
  const [membership] = await sql`
    select role, staff_id, guardian_id, student_id from public.memberships
    where institution_id = ${fixture.institutionId} and user_id = ${fixture.users[role].id}
  `;
  const [profile] = await sql`
    select full_name, phone, avatar_path, is_platform_admin
    from public.profiles where id = ${fixture.users[role].id}
  `;

  return {
    institution: {
      id: institution.id,
      slug: institution.slug,
      name: institution.name,
      settings: institution.settings ?? {},
      ai_policy: institution.ai_policy,
      is_demo: institution.is_demo,
    },
    user: {
      id: fixture.users[role].id,
      profile: {
        fullName: profile.full_name,
        phone: profile.phone,
        avatarPath: profile.avatar_path,
        isPlatformAdmin: profile.is_platform_admin,
      },
    },
    membership: {
      role,
      staffId: membership.staff_id,
      guardianId: membership.guardian_id,
      studentId: membership.student_id,
    },
    permissions: new Set(permissionsFor(role)),
  };
}

/**
 * Calls a `defineAction`-built action as a specific fixture role, using
 * defineAction's `overrideCtx` escape hatch (T-008) built from the role's
 * real membership row — no mocked cookies/session needed. Also points the
 * opt-in `@/lib/supabase/server` mock (server-client-mock.ts) at that role's
 * real signed-in client for the duration of the call, so a handler's own
 * `createClient()` calls run with real RLS as that role too — but only for
 * test files that actually `vi.mock` that module; every other db test's
 * handlers still use the real cookie-backed client untouched.
 */
export async function callAs<I, O>(
  fixture: TestInstitution,
  role: FixtureRole,
  action: (institutionSlug: string, raw: I, overrideCtx?: TenantContext) => Promise<ActionResult<O>>,
  input: I,
): Promise<ActionResult<O>> {
  const ctx = await buildContext(fixture, role);
  // Only load-bearing for test files that `vi.mock("@/lib/supabase/server", ...)`
  // the opt-in mock (server-client-mock.ts) — a harmless no-op write into an
  // unused module instance for every other db test, which still imports the
  // real `@/lib/supabase/server`.
  setActingClient(fixture.clientAs(role) as unknown as SupabaseClient<Database>);
  inFlightCalls += 1;
  try {
    return await action(fixture.slug, input, ctx);
  } finally {
    // Concurrent callAs (same role) share the single acting client; only the last one clears it.
    inFlightCalls -= 1;
    if (inFlightCalls === 0) setActingClient(null);
  }
}

let inFlightCalls = 0;

export async function closeActionsHelper(): Promise<void> {
  await sql.end();
}
