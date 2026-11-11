// 0135 — dashboard_preferences RLS: own row only, member of the institution only.
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });
const layout = { hidden: ["upcoming"], order: ["kpi-strip", "fees-by-class"] };

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const created: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((inst) => inst.cleanup()));
});

describe("dashboard_preferences RLS", () => {
  it("a user can save, read, update and delete their own layout", async () => {
    const inst = await createTestInstitution("dash-prefs-own");
    created.push(inst);
    const principal = inst.clientAs("principal");
    const row = { institution_id: inst.institutionId, user_id: inst.users.principal.id, layout };

    const saved = await principal.from("dashboard_preferences").upsert(row, { onConflict: "institution_id,user_id" });
    expect(saved.error).toBeNull();

    const read = await principal.from("dashboard_preferences").select("layout").eq("institution_id", inst.institutionId);
    expect(read.data).toEqual([{ layout }]);

    const updated = await principal.from("dashboard_preferences").upsert({ ...row, layout: { hidden: [], order: [] } }, { onConflict: "institution_id,user_id" });
    expect(updated.error).toBeNull();

    const deleted = await principal.from("dashboard_preferences").delete().eq("institution_id", inst.institutionId).select("user_id");
    expect(deleted.data).toHaveLength(1);
  });

  it("another member, even an owner, cannot read, update or delete someone else's row", async () => {
    const inst = await createTestInstitution("dash-prefs-other");
    created.push(inst);
    await sql`insert into public.dashboard_preferences (institution_id, user_id, layout) values (${inst.institutionId}, ${inst.users.teacher.id}, ${sql.json(layout)})`;

    for (const role of ["owner", "guardian"] as const) {
      const client = inst.clientAs(role);
      const read = await client.from("dashboard_preferences").select("user_id").eq("user_id", inst.users.teacher.id);
      expect(read.data ?? []).toHaveLength(0);
      const updated = await client.from("dashboard_preferences").update({ layout: {} }).eq("user_id", inst.users.teacher.id).select("user_id");
      expect(updated.data ?? []).toHaveLength(0);
      const deleted = await client.from("dashboard_preferences").delete().eq("user_id", inst.users.teacher.id).select("user_id");
      expect(deleted.data ?? []).toHaveLength(0);
    }
    const [still] = await sql`select layout from public.dashboard_preferences where user_id = ${inst.users.teacher.id}`;
    expect(still.layout).toEqual(layout);
  });

  it("cannot insert a row for another user_id (42501)", async () => {
    const inst = await createTestInstitution("dash-prefs-forge");
    created.push(inst);
    const result = await inst
      .clientAs("teacher")
      .from("dashboard_preferences")
      .insert({ institution_id: inst.institutionId, user_id: inst.users.owner.id, layout });
    expect(result.error?.code).toBe("42501");
  });

  it("a member of school A cannot write a row for school B", async () => {
    const a = await createTestInstitution("dash-prefs-a");
    const b = await createTestInstitution("dash-prefs-b");
    created.push(a, b);
    const result = await a
      .clientAs("owner")
      .from("dashboard_preferences")
      .insert({ institution_id: b.institutionId, user_id: a.users.owner.id, layout });
    expect(result.error?.code).toBe("42501");
    const rows = await sql`select 1 from public.dashboard_preferences where institution_id = ${b.institutionId}`;
    expect(rows).toHaveLength(0);
  });

  it("rejects an oversize or non-object layout", async () => {
    const inst = await createTestInstitution("dash-prefs-cap");
    created.push(inst);
    const client = inst.clientAs("teacher");
    const base = { institution_id: inst.institutionId, user_id: inst.users.teacher.id };
    const array = await client.from("dashboard_preferences").insert({ ...base, layout: [] });
    expect(array.error).not.toBeNull();
    const big = await client.from("dashboard_preferences").insert({ ...base, layout: { pad: "x".repeat(5000) } });
    expect(big.error).not.toBeNull();
  });
});
