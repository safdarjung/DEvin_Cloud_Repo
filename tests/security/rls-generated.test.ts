import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, ROLES, type TestInstitution } from "../helpers/roles";
import { RLS_EXPECTATIONS } from "./rls-expectations";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

// 07 §6 C-01: every tenant table (has an institution_id column) must have a
// declared expectation, or this fails naming the table.
async function discoverTenantTables(): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'institution_id'
    order by table_name
  `;
  return rows.map((r) => r.table_name);
}

let a: TestInstitution;
let b: TestInstitution;
let tenantTables: string[];

beforeAll(async () => {
  [tenantTables, a, b] = await Promise.all([
    discoverTenantTables(),
    createTestInstitution("gen-a"),
    createTestInstitution("gen-b"),
  ]);
}, 60_000);

afterAll(async () => {
  await Promise.all([a.cleanup(), b.cleanup()]);
  await sql.end();
  await closeRolesHelper();
}, 60_000);

describe("C-01: generated RLS suite", () => {
  it("every discovered tenant table has a declared expectation", () => {
    const missing = tenantTables.filter((t) => !(t in RLS_EXPECTATIONS));
    expect(missing).toEqual([]);
  });

  it("every declared tenant-table expectation still exists in the database", () => {
    // profiles/institutions have no institution_id column (global / tenant
    // root, respectively) — not part of the auto-discovered set.
    const tenantOnly = Object.keys(RLS_EXPECTATIONS).filter(
      (t) => t !== "profiles" && t !== "institutions",
    );
    const extra = tenantOnly.filter((t) => !tenantTables.includes(t));
    expect(extra).toEqual([]);
  });

  describe.each(
    Object.keys(RLS_EXPECTATIONS).filter((table) => table !== "profiles" && table !== "institutions"),
  )("%s", (table) => {
    for (const role of ROLES) {
      it(`${role}: cross-institution SELECT returns 0 rows`, async () => {
        const client = a.clientAs(role);
        const { data, error } = await client.from(table).select("*").eq("institution_id", b.institutionId);

        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      });
    }
  });

  it("cross-institution UPDATE on memberships is denied for every role", async () => {
    for (const role of ROLES) {
      const client = a.clientAs(role);
      const { error, data } = await client
        .from("memberships")
        .update({ status: "disabled" })
        .eq("institution_id", b.institutionId)
        .select("id");

      // RLS denies the match entirely: either an error, or 0 rows affected.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    }

    const stillActive = await sql`
      select status from public.memberships where institution_id = ${b.institutionId} and status = 'active'
    `;
    expect(stillActive).toHaveLength(ROLES.length);
  });

  it("teacher cannot read institution_sequences, even within their own institution (T-009 AC3)", async () => {
    await sql`
      insert into public.institution_sequences (institution_id, key, next_value, pattern)
      values (${a.institutionId}, 'ac3-probe', 1, null)
      on conflict do nothing
    `;

    const { data, error } = await a
      .clientAs("teacher")
      .from("institution_sequences")
      .select("*")
      .eq("institution_id", a.institutionId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("cross-institution INSERT into campuses is denied for every role", async () => {
    for (const role of ROLES) {
      const client = a.clientAs(role);
      const { error } = await client
        .from("campuses")
        .insert({ institution_id: b.institutionId, name: `intrusion-${role}` });

      expect(error).not.toBeNull();
    }
  });
});
