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

// 07 §6 C-01 (M27-T4): rowsecurity flag per discovered tenant table, and the
// set of tables with at least one permissive INSERT/UPDATE/DELETE/ALL policy
// (the write-policy catalog checks below).
async function fetchRlsCatalog(
  tables: string[],
): Promise<{ rowsecurity: Map<string, boolean>; writable: Set<string> }> {
  const rlsRows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select c.relname, c.relrowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(${tables})
  `;
  const policyRows = await sql<{ tablename: string; cmd: string; permissive: string }[]>`
    select tablename, cmd, permissive from pg_policies
    where schemaname = 'public' and tablename = any(${tables})
  `;
  const rowsecurity = new Map(rlsRows.map((r) => [r.relname, r.relrowsecurity]));
  const writable = new Set(
    policyRows
      .filter((p) => p.permissive === "PERMISSIVE" && ["INSERT", "UPDATE", "DELETE", "ALL"].includes(p.cmd))
      .map((p) => p.tablename),
  );
  return { rowsecurity, writable };
}

let a: TestInstitution;
let b: TestInstitution;
let tenantTables: string[];
let rlsCatalog: { rowsecurity: Map<string, boolean>; writable: Set<string> };

beforeAll(async () => {
  [tenantTables, a, b] = await Promise.all([
    discoverTenantTables(),
    createTestInstitution("gen-a"),
    createTestInstitution("gen-b"),
  ]);
  rlsCatalog = await fetchRlsCatalog(tenantTables);
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
        // M03-T1: invitations has column-level grants (token_hash excluded,
        // 20261028000064) — `select("*")` 42501s at the grant layer before
        // RLS ever runs. selectColumns lets a table like that assert the
        // same cross-institution claim over its actually-grantable columns.
        const columns = RLS_EXPECTATIONS[table].selectColumns?.join(",") ?? "*";
        const { data, error } = await client.from(table).select(columns).eq("institution_id", b.institutionId);

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

  // M27-T4: RLS catalog audit — every discovered tenant table, not one
  // hand-picked table at a time.
  it("every tenant table has RLS enabled", () => {
    const disabled = tenantTables.filter((t) => rlsCatalog.rowsecurity.get(t) !== true);
    expect(disabled).toEqual([]);
  });

  it("write: [] tables have no permissive write policy", () => {
    const violating = Object.keys(RLS_EXPECTATIONS)
      .filter((t) => tenantTables.includes(t) && RLS_EXPECTATIONS[t].write.length === 0)
      .filter((t) => rlsCatalog.writable.has(t));
    expect(violating).toEqual([]);
  });

  it("tables with writers have a permissive write policy", () => {
    const missing = Object.keys(RLS_EXPECTATIONS)
      .filter((t) => tenantTables.includes(t) && RLS_EXPECTATIONS[t].write.length > 0)
      .filter((t) => !rlsCatalog.writable.has(t));
    expect(missing).toEqual([]);
  });

  // M27-T4: cross-institution INSERT probe, every table × role. RLS WITH
  // CHECK runs before NOT NULL/FK/CHECK, so `{ institution_id: b }` alone is
  // enough to prove the point without satisfying every other column.
  it(
    "cross-institution INSERT is rejected by RLS or a coded guard, for every table and role",
    async () => {
      const tables = Object.keys(RLS_EXPECTATIONS).filter(
        (t) => t !== "profiles" && t !== "institutions",
      );
      for (const table of tables) {
        const exception = RLS_EXPECTATIONS[table].insertProbeException;
        for (const role of ROLES) {
          const { error } = await a
            .clientAs(role)
            .from(table)
            .insert({ institution_id: b.institutionId });

          expect(error, `${table} / ${role} accepted a foreign institution_id`).not.toBeNull();
          if (exception) continue; // documented deviation (DBT id) — any rejection counts

          const code = error?.code;
          const message = error?.message ?? "";
          const isExpectedCode = code === "42501" || (code === "P0001" && message.startsWith("code:"));
          expect(isExpectedCode, `${table} / ${role}: got ${code} "${message}"`).toBe(true);
        }
      }
    },
    180_000,
  );
});
