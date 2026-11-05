import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { permissionsFor, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";

// Module-level postgres connection and institution state.
let internalSql: postgres.Sql | null = null;
export let sql: postgres.Sql | null = null;
export let institutionId: string;
export let institutionSettings: Record<string, unknown>;

const SEED_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "CoolSkool-Demo-2026";

/** Initialize the demo helper by resolving st-josephs-demo institution. */
async function initDemoHelper(): Promise<void> {
  if (internalSql) return; // Already initialized
  internalSql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
  sql = internalSql; // Export for test use
  const [row] = await internalSql`select id, settings from public.institutions where slug = 'st-josephs-demo'`;
  if (!row) throw new Error("Demo institution not found — run `pnpm db:reset` first.");
  institutionId = row.id as string;
  institutionSettings = (row.settings ?? {}) as Record<string, unknown>;
}

/** Real demo sign-in, with one retry (lead instruction) for a transient failure mid-reset. */
export async function signInDemo(
  loginKey: string,
  retry = true,
): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error } = await client.auth.signInWithPassword({
    email: `${loginKey}@demo.coolskool.test`,
    password: SEED_PASSWORD,
  });
  if (error) {
    if (retry) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return signInDemo(loginKey, false);
    }
    throw error;
  }
  return client;
}

/** Builds a real TenantContext for a seeded demo user. Resolves st-josephs-demo institution itself. */
export async function buildDemoContext(
  loginKey: string,
  role: Role,
): Promise<{ ctx: TenantContext; client: SupabaseClient<Database> }> {
  await initDemoHelper();
  const client = await signInDemo(loginKey);
  const [user] = await sql!`select id from auth.users where email = ${`${loginKey}@demo.coolskool.test`}`;
  const [membership] = await sql!`
    select staff_id, guardian_id, student_id from public.memberships
    where institution_id = ${institutionId} and user_id = ${user.id} and status = 'active'
  `;
  const [profile] = await sql!`select full_name, phone, avatar_path, is_platform_admin from public.profiles where id = ${user.id}`;
  const [institution] = await sql!`select slug, name, ai_policy, is_demo from public.institutions where id = ${institutionId}`;

  const ctx: TenantContext = {
    institution: {
      id: institutionId,
      slug: institution.slug as string,
      name: institution.name as string,
      settings: institutionSettings,
      ai_policy: institution.ai_policy as TenantContext["institution"]["ai_policy"],
      is_demo: institution.is_demo as boolean,
    },
    user: {
      id: user.id as string,
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
  return { ctx, client };
}

/** Times an async function. */
export async function timed<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: performance.now() - start };
}

/** Merges module overrides into a context's settings without writing to the DB. */
export function withModules(
  ctx: TenantContext,
  overrides: Record<string, boolean>,
): TenantContext {
  return {
    ...ctx,
    institution: {
      ...ctx.institution,
      settings: {
        ...ctx.institution.settings,
        modules: {
          ...(ctx.institution.settings.modules as Record<string, boolean>),
          ...overrides,
        },
      },
    },
  };
}

/** Ends the demo helper's postgres pool. */
export async function closeDemoHelper(): Promise<void> {
  if (internalSql) {
    await internalSql.end();
    internalSql = null;
    sql = null;
  }
}
