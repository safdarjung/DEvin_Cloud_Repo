import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";

// createAdminClient() requires this; set once here rather than depending on
// globalSetup env propagation across worker processes (unreliable across
// Vitest pool configurations) — reliable because it runs in the same
// process that imports this module.
process.env.SERVICE_ROLE_CALLER = "test";

export const ROLES = [
  "owner",
  "principal",
  "admin",
  "admissions",
  "accountant",
  "exam_controller",
  "teacher",
  "student",
  "guardian",
] as const;

export type FixtureRole = (typeof ROLES)[number];

const PASSWORD = "correct-horse-battery-staple";

function randomPhone(): string {
  const first = String(6 + Math.floor(Math.random() * 4)); // 6-9
  const rest = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join("");
  return first + rest;
}

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

export interface TestInstitution {
  institutionId: string;
  slug: string;
  users: Record<FixtureRole, { id: string; email: string }>;
  /** Real signed-in supabase-js client for that role's JWT — real RLS. */
  clientAs(role: FixtureRole): SupabaseClient;
  /** Publishable-key client with no session, for class P / anon checks. */
  clientAsAnon(): SupabaseClient;
  cleanup(): Promise<void>;
}

/**
 * Creates a demo-flagged (`is_demo = true`) institution with one real
 * auth user + membership per role, and a signed-in supabase-js client per
 * role (08 §1). `name` only needs to be unique within a test run.
 */
export async function createTestInstitution(name: string): Promise<TestInstitution> {
  const institutionId = crypto.randomUUID();
  const slug = `test-${name}-${institutionId}`;
  const admin = adminClient();

  await sql`insert into public.institutions (id, slug, name, is_demo) values (${institutionId}, ${slug}, ${name}, true)`;

  const users = {} as TestInstitution["users"];
  const clients = {} as Record<FixtureRole, SupabaseClient>;

  for (const role of ROLES) {
    const email = `test-${name}-${role}-${crypto.randomUUID()}@test.coolskool.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw error ?? new Error(`failed to create test user for ${role}`);
    users[role] = { id: data.user.id, email };

    if (role === "guardian") {
      const [guardian] = await sql`
        insert into public.guardians (institution_id, full_name, phone)
        values (${institutionId}, ${`Test Guardian ${role}`}, ${randomPhone()})
        returning id
      `;
      await sql`
        insert into public.memberships (institution_id, user_id, role, guardian_id)
        values (${institutionId}, ${data.user.id}, ${role}, ${guardian.id})
      `;
    } else if (role === "student") {
      const [student] = await sql`
        insert into public.students (institution_id, admission_no, first_name, dob, gender)
        values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test', '2015-01-01', 'other')
        returning id
      `;
      await sql`
        insert into public.memberships (institution_id, user_id, role, student_id)
        values (${institutionId}, ${data.user.id}, ${role}, ${student.id})
      `;
    } else {
      const [staff] = await sql`
        insert into public.staff (institution_id, employee_no, full_name, designation)
        values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, ${`Test ${role}`}, ${role})
        returning id
      `;
      await sql`
        insert into public.memberships (institution_id, user_id, role, staff_id)
        values (${institutionId}, ${data.user.id}, ${role}, ${staff.id})
      `;
    }

    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
    );
    const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (signInError) throw signInError;
    clients[role] = client;
  }

  return {
    institutionId,
    slug,
    users,
    clientAs: (role) => clients[role],
    clientAsAnon: () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
      ),
    cleanup: async () => {
      await sql`select app.demo_reset(${institutionId}::uuid)`;
      await sql`delete from public.institutions where id = ${institutionId}`;
      await Promise.all(Object.values(users).map((u) => admin.auth.admin.deleteUser(u.id)));
    },
  };
}

export async function withTwoInstitutions(
  fn: (a: TestInstitution, b: TestInstitution) => Promise<void>,
): Promise<void> {
  const a = await createTestInstitution("a");
  const b = await createTestInstitution("b");
  try {
    await fn(a, b);
  } finally {
    await a.cleanup();
    await b.cleanup();
  }
}

export async function closeRolesHelper(): Promise<void> {
  await sql.end();
}
