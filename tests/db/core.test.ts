import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Minimal inline per-role query helper (T-004). T-009 replaces this with
// tests/helpers/roles.ts; the pattern mirrors what PostgREST sets up per
// request: `request.jwt.claims` (read by `auth.uid()`) plus `set local role`.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
});

async function asUser<T>(
  userId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  });
  return result as T;
}

const TENANT_TABLES = ["campuses", "academic_years", "terms", "memberships"] as const;

describe("core migration (0002) RLS", () => {
  const instA = "00000000-0000-0000-0000-00000000a001";
  const instB = "00000000-0000-0000-0000-00000000a002";
  const userA = "00000000-0000-0000-0000-00000000a0a1";
  const userB = "00000000-0000-0000-0000-00000000a0b1";
  const yearB = "00000000-0000-0000-0000-00000000a0b2";

  beforeAll(async () => {
    await sql`
      insert into auth.users (id, email, raw_user_meta_data) values
        (${userA}, 'a@foundation.test', ${sql.json({ full_name: "User A" })}),
        (${userB}, 'b@foundation.test', ${sql.json({ full_name: "User B" })})
    `;
    await sql`
      insert into public.institutions (id, slug, name) values
        (${instA}, 'core-test-a', 'Core Test A'),
        (${instB}, 'core-test-b', 'Core Test B')
    `;
    const [staffA, staffB] = await sql`
      insert into public.staff (institution_id, employee_no, full_name, designation) values
        (${instA}, 'EMP-A', 'Staff A', 'Owner'),
        (${instB}, 'EMP-B', 'Staff B', 'Owner')
      returning id
    `;
    await sql`
      insert into public.memberships (institution_id, user_id, role, staff_id) values
        (${instA}, ${userA}, 'owner', ${staffA.id}),
        (${instB}, ${userB}, 'owner', ${staffB.id})
    `;
    await sql`
      insert into public.academic_years (id, institution_id, name, starts_on, ends_on, is_current) values
        (${yearB}, ${instB}, '2026-27', '2026-04-01', '2027-03-31', true)
    `;
    await sql`
      insert into public.campuses (institution_id, name) values (${instB}, 'Main Campus')
    `;
  });

  afterAll(async () => {
    await sql`delete from public.campuses where institution_id in (${instA}, ${instB})`;
    await sql`delete from public.terms where institution_id in (${instA}, ${instB})`;
    await sql`delete from public.academic_years where institution_id in (${instA}, ${instB})`;
    await sql`delete from public.memberships where institution_id in (${instA}, ${instB})`;
    await sql`delete from public.staff where institution_id in (${instA}, ${instB})`;
    // memberships inserts/updates above fired the 0003 membership_audit trigger;
    // audit_events is append-only (block_mutation), so bypass it like demo_reset does.
    await sql.begin(async (tx) => {
      await tx`select set_config('app.allow_reset', 'on', true)`;
      await tx`delete from public.audit_events where institution_id in (${instA}, ${instB})`;
    });
    await sql`delete from public.institutions where id in (${instA}, ${instB})`;
    await sql`delete from auth.users where id in (${userA}, ${userB})`;
  });

  it("C-01: user A cannot SELECT institution B's row", async () => {
    const rows = await asUser(userA, (tx) => tx`select id from public.institutions where id = ${instB}`);
    expect(rows).toHaveLength(0);
  });

  it("C-01: user A sees only institution A for its slug, a non-member sees none", async () => {
    const asA = await asUser(userA, (tx) => tx`select id from public.institutions where slug = 'core-test-a'`);
    expect(asA).toHaveLength(1);

    const asB = await asUser(userB, (tx) => tx`select id from public.institutions where slug = 'core-test-a'`);
    expect(asB).toHaveLength(0);
  });

  it("C-01: user A cannot UPDATE institution B's row", async () => {
    const result = await asUser(
      userA,
      (tx) => tx`update public.institutions set name = 'hijacked' where id = ${instB}`,
    );
    expect(result.count).toBe(0);
  });

  for (const table of TENANT_TABLES) {
    it(`C-01: user A cannot SELECT ${table} rows belonging to institution B`, async () => {
      const rows = await asUser(
        userA,
        (tx) => tx`select * from public.${tx(table)} where institution_id = ${instB}`,
      );
      expect(rows).toHaveLength(0);
    });

    it(`C-01: user A cannot UPDATE or DELETE ${table} rows belonging to institution B`, async () => {
      const updateResult = await asUser(
        userA,
        (tx) => tx`update public.${tx(table)} set updated_at = now() where institution_id = ${instB}`,
      );
      expect(updateResult.count).toBe(0);

      const deleteResult = await asUser(
        userA,
        (tx) => tx`delete from public.${tx(table)} where institution_id = ${instB}`,
      );
      expect(deleteResult.count).toBe(0);
    });
  }

  it("C-01: user A cannot INSERT a campus into institution B", async () => {
    await expect(
      asUser(
        userA,
        (tx) => tx`insert into public.campuses (institution_id, name) values (${instB}, 'intrusion')`,
      ),
    ).rejects.toThrow();
  });

  it("C-02: disabling a membership makes app.is_member false immediately", async () => {
    const before = await asUser(userB, (tx) => tx`select app.is_member(${instB}::uuid) as is_member`);
    expect(before[0].is_member).toBe(true);

    await sql`update public.memberships set status = 'disabled' where institution_id = ${instB} and user_id = ${userB}`;

    const after = await asUser(userB, (tx) => tx`select app.is_member(${instB}::uuid) as is_member`);
    expect(after[0].is_member).toBe(false);

    await sql`update public.memberships set status = 'active' where institution_id = ${instB} and user_id = ${userB}`;
  });

  it("C-05: a second is_current=true academic year for the same institution fails", async () => {
    await expect(
      sql`
        insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
        values (${instB}, '2027-28', '2027-04-01', '2028-03-31', true)
      `,
    ).rejects.toThrow();
  });

  it("C-05: a term outside its academic year's dates fails", async () => {
    await expect(
      sql`
        insert into public.terms (institution_id, academic_year_id, name, sequence, starts_on, ends_on)
        values (${instB}, ${yearB}, 'Term 1', 1, '2026-01-01', '2026-06-30')
      `,
    ).rejects.toThrow(/validation_failed/);
  });

  it("inserting an auth.users row creates a matching profiles row", async () => {
    const newUserId = "00000000-0000-0000-0000-00000000a0c1";
    try {
      await sql`
        insert into auth.users (id, email, raw_user_meta_data)
        values (${newUserId}, 'c@foundation.test', ${sql.json({ full_name: "User C" })})
      `;
      const [profile] = await sql`select full_name from public.profiles where id = ${newUserId}`;
      expect(profile.full_name).toBe("User C");
    } finally {
      await sql`delete from auth.users where id = ${newUserId}`;
    }
  });
});
