import postgres from "postgres";
import type { ActionResult } from "@/lib/actions/result";
import { permissionsFor } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import type { FixtureRole, TestInstitution } from "./roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

async function buildContext(fixture: TestInstitution, role: FixtureRole): Promise<TenantContext> {
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
 * real membership row — no mocked cookies/session needed. Proves the
 * permission gate and the handler's own logic faithfully; a handler that
 * calls `@/lib/supabase/server` itself for further DB work still runs
 * unauthenticated, since overrideCtx only replaces context resolution, not
 * the ambient request session — not a limitation any current handler hits.
 */
export async function callAs<I, O>(
  fixture: TestInstitution,
  role: FixtureRole,
  action: (institutionSlug: string, raw: I, overrideCtx?: TenantContext) => Promise<ActionResult<O>>,
  input: I,
): Promise<ActionResult<O>> {
  const ctx = await buildContext(fixture, role);
  return action(fixture.slug, input, ctx);
}

export async function closeActionsHelper(): Promise<void> {
  await sql.end();
}
