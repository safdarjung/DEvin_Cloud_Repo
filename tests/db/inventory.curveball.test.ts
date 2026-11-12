// Curveball sweep (inventory): updateInventoryItem at the action layer; stock never negative under concurrency or adjust.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createInventoryItem, recordInventoryMovement, updateInventoryItem } from "@/modules/inventory/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let inst: TestInstitution;
let other: TestInstitution;

async function item(i: TestInstitution = inst, stock = 0): Promise<string> {
  const r = await callAs(i, "accountant", createInventoryItem, { name: `Item ${crypto.randomUUID().slice(0, 8)}`, unit: "box", reorderLevel: 1 });
  if (!r.ok) throw new Error(r.error.code);
  if (stock > 0) {
    const m = await callAs(i, "accountant", recordInventoryMovement, { itemId: r.data.id, kind: "in", quantity: stock });
    if (!m.ok) throw new Error(m.error.code);
  }
  return r.data.id;
}
async function stockOf(itemId: string): Promise<number> {
  const [r] = await sql`select coalesce(sum(quantity), 0)::int as s from public.inventory_movements where item_id = ${itemId}`;
  return r.s as number;
}

beforeAll(async () => {
  inst = await createTestInstitution("inv-cb");
  other = await createTestInstitution("inv-cb-x");
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("inventory curveballs", () => {
  it("two parallel issues of 6 from a stock of 10: exactly one succeeds, stock never negative", async () => {
    const id = await item(inst, 10);
    const rs = await Promise.all([1, 2].map(() => callAs(inst, "accountant", recordInventoryMovement, { itemId: id, kind: "issue", quantity: 6 })));
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(await stockOf(id)).toBe(4);
  });

  it("a negative adjust below zero is refused; stock unchanged", async () => {
    const id = await item(inst, 3);
    const r = await callAs(inst, "accountant", recordInventoryMovement, { itemId: id, kind: "adjust", quantity: -4 });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.error.code).not.toBe("internal");
    expect(await stockOf(id)).toBe(3);
  });

  it.each([
    ["zero adjust", "adjust", 0],
    ["negative issue", "issue", -2],
    ["fractional", "in", 1.5],
    ["zero in", "in", 0],
  ])("%s → validation_failed on quantity", async (_l, kind, quantity) => {
    const r = await callAs(inst, "accountant", recordInventoryMovement, { itemId: await item(), kind, quantity });
    expect(r.ok ? null : r.error.fieldErrors?.quantity).toBeTruthy();
  });

  it("an inactive item takes no new movements", async () => {
    const id = await item(inst, 5);
    const u = await callAs(inst, "admin", updateInventoryItem, { id, name: "Retired", unit: "box", reorderLevel: 1, isActive: false });
    expect(u.ok).toBe(true);
    const r = await callAs(inst, "accountant", recordInventoryMovement, { itemId: id, kind: "in", quantity: 1 });
    expect(r.ok).toBe(false);
    expect(await stockOf(id)).toBe(5);
  });

  it("update: another school's item / unknown id → not_found; teacher forbidden; reorderLevel -1 → validation_failed", async () => {
    const theirs = await item(other);
    const cross = await callAs(inst, "accountant", updateInventoryItem, { id: theirs, name: "Mine", unit: "box", reorderLevel: 1, isActive: true });
    expect(cross.ok ? null : cross.error.code).toBe("not_found");
    const unknown = await callAs(inst, "accountant", updateInventoryItem, { id: crypto.randomUUID(), name: "X", unit: "box", reorderLevel: 1, isActive: true });
    expect(unknown.ok ? null : unknown.error.code).toBe("not_found");
    const t = await callAs(inst, "teacher", updateInventoryItem, { id: await item(), name: "X", unit: "box", reorderLevel: 1, isActive: true });
    expect(t.ok ? null : t.error.code).toBe("forbidden");
    const neg = await callAs(inst, "accountant", updateInventoryItem, { id: await item(), name: "X", unit: "box", reorderLevel: -1, isActive: true });
    expect(neg.ok ? null : neg.error.fieldErrors?.reorderLevel).toBeTruthy();
  });

  it("a duplicate item name → conflict (not internal)", async () => {
    const name = `Dup ${crypto.randomUUID().slice(0, 6)}`;
    expect((await callAs(inst, "accountant", createInventoryItem, { name, unit: "box", reorderLevel: 0 })).ok).toBe(true);
    const dup = await callAs(inst, "accountant", createInventoryItem, { name, unit: "box", reorderLevel: 0 });
    expect(dup.ok ? null : dup.error.code).toBe("conflict");
  });
});
