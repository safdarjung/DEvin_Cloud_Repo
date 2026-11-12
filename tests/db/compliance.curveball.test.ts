// Curveball sweep (compliance): updateComplianceItem at the action layer, renew/delete/starter misuse.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createComplianceItem, deleteComplianceItem, loadComplianceStarter, renewComplianceItem, updateComplianceItem } from "@/modules/compliance/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let inst: TestInstitution;
let other: TestInstitution;

async function item(i: TestInstitution = inst, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await callAs(i, "admin", createComplianceItem, { title: `NOC ${crypto.randomUUID().slice(0, 6)}`, category: "safety", dueOn: "2030-03-01", ...extra });
  if (!r.ok) throw new Error(r.error.code);
  return r.data.id;
}

beforeAll(async () => {
  inst = await createTestInstitution("cmp-cb");
  other = await createTestInstitution("cmp-cb-x");
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("compliance curveballs", () => {
  it("update edits fields but never due_on (dueOn is not even accepted)", async () => {
    const id = await item();
    const r = await callAs(inst, "admin", updateComplianceItem, { id, title: "Fire NOC (renamed)", category: "safety", dueOn: "2099-01-01" });
    expect(r.ok ? null : r.error.code).toBe("validation_failed");
    const ok = await callAs(inst, "admin", updateComplianceItem, { id, title: "Fire NOC (renamed)", category: "safety", renewEveryMonths: 24 });
    expect(ok.ok).toBe(true);
    const [row] = await sql`select title, due_on::text as d, renew_every_months from public.compliance_items where id = ${id}`;
    expect([row.title, row.d, row.renew_every_months]).toEqual(["Fire NOC (renamed)", "2030-03-01", 24]);
  });

  it("update: another school's item / unknown id → not_found; teacher and accountant forbidden", async () => {
    const theirs = await item(other);
    const cross = await callAs(inst, "admin", updateComplianceItem, { id: theirs, title: "Mine", category: "safety" });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
    const unknown = await callAs(inst, "admin", updateComplianceItem, { id: crypto.randomUUID(), title: "X", category: "safety" });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const id = await item();
    for (const role of ["teacher", "accountant"] as const) {
      const r = await callAs(inst, role, updateComplianceItem, { id, title: "X", category: "safety" });
      expect(r.ok ? null : r.error.code).toBe("forbidden");
    }
  });

  it("update with another school's staff as owner is refused and leaves the owner unset", async () => {
    const id = await item();
    const [s] = await sql`select staff_id from public.memberships where institution_id = ${other.institutionId} and role = 'teacher'`;
    const r = await callAs(inst, "admin", updateComplianceItem, { id, title: "Fire NOC", category: "safety", ownerStaffId: s.staff_id });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.code).not.toBe("internal");
    const [row] = await sql`select owner_staff_id from public.compliance_items where id = ${id}`;
    expect(row.owner_staff_id).toBeNull();
  });

  it.each([
    ["unknown category", { title: "X", category: "tax" }, "category"],
    ["renewEveryMonths 0", { title: "X", category: "safety", renewEveryMonths: 0 }, "renewEveryMonths"],
    ["renewEveryMonths 121", { title: "X", category: "safety", renewEveryMonths: 121 }, "renewEveryMonths"],
    ["blank title", { title: " ", category: "safety" }, "title"],
  ])("update: %s → validation_failed on %s", async (_l, body, field) => {
    const r = await callAs(inst, "admin", updateComplianceItem, { id: crypto.randomUUID(), ...body });
    expect(r.ok ? null : r.error.fieldErrors?.[field as string]).toBeTruthy();
  });

  it("renew: another school's item → not_found; two parallel renewals with the same date write events without corrupting due_on", async () => {
    const theirs = await item(other);
    const cross = await callAs(inst, "admin", renewComplianceItem, { itemId: theirs, newDueOn: "2031-03-01" });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
    const id = await item(inst, { renewEveryMonths: 12 });
    const rs = await Promise.all([1, 2].map(() => callAs(inst, "admin", renewComplianceItem, { itemId: id, newDueOn: "2031-03-01" })));
    expect(rs.some((r) => r.ok)).toBe(true);
    expect(rs.map((r) => (r.ok ? "ok" : r.error.code))).not.toContain("internal");
    const [row] = await sql`select due_on::text as d from public.compliance_items where id = ${id}`;
    expect(row.d).toBe("2031-03-01");
  });

  it("delete: unknown / another school's item → not_found and the foreign row survives", async () => {
    const theirs = await item(other);
    const r = await callAs(inst, "admin", deleteComplianceItem, { id: theirs });
    expect(r.ok ? null : r.error.code).toBe("not_found");
    const [c] = await sql`select count(*)::int as n from public.compliance_items where id = ${theirs}`;
    expect(c.n).toBe(1);
  });

  it("starter: empty list / 21 items → validation_failed; an unknown title → validation_failed and nothing inserted", async () => {
    const empty = await callAs(inst, "admin", loadComplianceStarter, { items: [] });
    expect(empty.ok ? null : empty.error.fieldErrors?.items).toBeTruthy();
    const many = await callAs(inst, "admin", loadComplianceStarter, { items: Array.from({ length: 21 }, (_, i) => ({ title: `T${i}`, dueOn: "2030-01-01" })) });
    expect(many.ok ? null : many.error.fieldErrors?.items).toBeTruthy();
    const [before] = await sql`select count(*)::int as n from public.compliance_items where institution_id = ${inst.institutionId}`;
    const unknown = await callAs(inst, "admin", loadComplianceStarter, { items: [{ title: "Not a starter item", dueOn: "2030-01-01" }] });
    expect(unknown.ok ? null : unknown.error.code).toBe("validation_failed");
    const [after] = await sql`select count(*)::int as n from public.compliance_items where institution_id = ${inst.institutionId}`;
    expect(after.n).toBe(before.n);
  });
});
