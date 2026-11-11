import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeInviteCodesHelper, mintInviteCode } from "../helpers/invite-codes";

// M03-T1 — public.create_institution (06 M03 Task 1). Real signed-in
// clients, same shape as tests/db/tenant-context.test.ts: a fresh auth user
// with zero memberships calls the RPC exactly as a brand-new onboarding
// user would over PostgREST.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const PASSWORD = "correct-horse-battery-staple";

function adminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
  );
}

async function newSignedInUser(label: string) {
  const email = `onboarding-rpc-${label}-${crypto.randomUUID()}@test.local`;
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
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;

  return { userId: data.user.id, email, client };
}

type SignedInClient = Awaited<ReturnType<typeof newSignedInUser>>["client"];

// 0127: `authenticated` reaches create_institution only through
// create_institution_with_invite, so every school here spends a fresh code.
async function createInstitution(client: SignedInClient, name: string, slug: string) {
  const { data, error } = await client.rpc("create_institution_with_invite", {
    p_code: await mintInviteCode(),
    p_name: name,
    p_slug: slug,
  });
  return { data: data?.[0]?.institution_id ?? null, error };
}

// Deletes everything create_institution could have written for these
// institution ids, in FK order; audit_events is immutable history (0003's
// block_mutation trigger) so its delete needs the same test-only bypass
// tenant-context.test.ts uses.
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
  await closeInviteCodesHelper();
});

describe("public.create_institution (M03-T1)", () => {
  it("a signed-in user cannot call create_institution directly (0127: invite code only)", async () => {
    const { userId, client } = await newSignedInUser("direct");
    userIdsToDelete.add(userId);

    const { data, error } = await client.rpc("create_institution", {
      p_name: "Direct School",
      p_slug: `onboard-direct-${crypto.randomUUID().slice(0, 8)}`,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("new user creates an institution and becomes its active owner", async () => {
    const { userId, client } = await newSignedInUser("basic");
    userIdsToDelete.add(userId);
    const slug = `onboard-basic-${crypto.randomUUID().slice(0, 8)}`;

    const { data, error } = await createInstitution(client, "New Basic School", slug);
    expect(error).toBeNull();
    const institutionId = data as string;
    institutionIdsToDelete.add(institutionId);

    const [membership] = await sql`
      select role, status, staff_id from public.memberships
      where institution_id = ${institutionId} and user_id = ${userId}
    `;
    expect(membership).toMatchObject({ role: "owner", status: "active" });
    expect(membership.staff_id).not.toBeNull();

    const [institution] = await sql`select slug, name from public.institutions where id = ${institutionId}`;
    expect(institution).toMatchObject({ slug, name: "New Basic School" });
  });

  it("default year + two terms exist and the year is current", async () => {
    const { userId, client } = await newSignedInUser("year");
    userIdsToDelete.add(userId);
    const slug = `onboard-year-${crypto.randomUUID().slice(0, 8)}`;

    const { data, error } = await createInstitution(client, "Year School", slug);
    expect(error).toBeNull();
    const institutionId = data as string;
    institutionIdsToDelete.add(institutionId);

    const years = await sql`select id, is_current, starts_on, ends_on from public.academic_years where institution_id = ${institutionId}`;
    expect(years).toHaveLength(1);
    expect(years[0].is_current).toBe(true);

    const terms = await sql`
      select name, sequence, starts_on, ends_on from public.terms
      where academic_year_id = ${years[0].id} order by sequence
    `;
    expect(terms).toHaveLength(2);
    expect(terms[0].name).toBe("Term 1");
    expect(terms[1].name).toBe("Term 2");
    expect(terms[0].starts_on.toISOString()).toBe(years[0].starts_on.toISOString());
    expect(terms[1].ends_on.toISOString()).toBe(years[0].ends_on.toISOString());
  });

  it("reserved slug → validation_failed", async () => {
    const { userId, client } = await newSignedInUser("reserved");
    userIdsToDelete.add(userId);

    const { error } = await createInstitution(client, "Reserved Slug School", "admin");
    expect(error?.message).toBe("code:validation_failed");
  });

  it("duplicate slug → conflict", async () => {
    const { userId: userId1, client: client1 } = await newSignedInUser("dup1");
    const { userId: userId2, client: client2 } = await newSignedInUser("dup2");
    userIdsToDelete.add(userId1);
    userIdsToDelete.add(userId2);
    const slug = `onboard-dup-${crypto.randomUUID().slice(0, 8)}`;

    const first = await createInstitution(client1, "Dup School One", slug);
    expect(first.error).toBeNull();
    institutionIdsToDelete.add(first.data as string);

    const second = await createInstitution(client2, "Dup School Two", slug);
    expect(second.error?.message).toBe("code:conflict");
  });

  it("fourth owned institution → quota_exceeded", async () => {
    const { userId, client } = await newSignedInUser("quota");
    userIdsToDelete.add(userId);

    for (let i = 0; i < 3; i++) {
      const slug = `onboard-quota-${i}-${crypto.randomUUID().slice(0, 8)}`;
      const result = await createInstitution(client, `Quota School ${i}`, slug);
      expect(result.error).toBeNull();
      institutionIdsToDelete.add(result.data as string);
    }

    const fourth = await createInstitution(client, "Quota School 4", `onboard-quota-4-${crypto.randomUUID().slice(0, 8)}`);
    expect(fourth.error?.message).toBe("code:quota_exceeded");
  });

  it("a member still cannot insert their own membership directly (guard intact)", async () => {
    const { userId, client } = await newSignedInUser("guard");
    userIdsToDelete.add(userId);
    const slug = `onboard-guard-${crypto.randomUUID().slice(0, 8)}`;

    const created = await createInstitution(client, "Guard School", slug);
    expect(created.error).toBeNull();
    const institutionId = created.data as string;
    institutionIdsToDelete.add(institutionId);

    const { userId: otherId, client: otherClient } = await newSignedInUser("guard-other");
    userIdsToDelete.add(otherId);
    const [staff] = await sql`
      insert into public.staff (institution_id, employee_no, full_name, designation)
      values (${institutionId}, 'EMP-GUARD', 'Guard Other', 'Teacher')
      returning id
    `;

    const { error } = await otherClient
      .from("memberships")
      .insert({ institution_id: institutionId, user_id: otherId, role: "teacher", status: "active", staff_id: staff.id });
    expect(error).not.toBeNull();
  });

  it("invitations.token_hash is not selectable by an admin", async () => {
    const { userId, client } = await newSignedInUser("invitations");
    userIdsToDelete.add(userId);
    const slug = `onboard-inv-${crypto.randomUUID().slice(0, 8)}`;

    const created = await createInstitution(client, "Invitations School", slug);
    expect(created.error).toBeNull();
    const institutionId = created.data as string;
    institutionIdsToDelete.add(institutionId);

    const { error } = await client.from("invitations").select("token_hash").eq("institution_id", institutionId);
    expect(error).not.toBeNull();

    const ok = await client.from("invitations").select("id, email, role").eq("institution_id", institutionId);
    expect(ok.error).toBeNull();
  });
});
