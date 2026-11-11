// Features-18 #11 — inventory: append-only movements, definer stock rule, RLS, actions.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createInventoryItem, recordInventoryMovement } from "@/modules/inventory/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let inst: TestInstitution;
let other: TestInstitution;
let itemId: string;

beforeAll(async () => {
  inst = await createTestInstitution("inv");
  other = await createTestInstitution("inv-x");
  const r = await callAs(inst, "accountant", createInventoryItem, { name: "Chalk", unit: "box", reorderLevel: 5 });
  if (!r.ok) throw new Error("fixture item failed");
  itemId = r.data.id;
});

afterAll(async () => {
  await inst.cleanup();
  await other.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const mv = (kind: "in" | "issue" | "return" | "adjust", quantity: number) => ({ itemId, kind, quantity });

describe("inventory", () => {
  it("allowed roles record movements and stock comes from inventory_stock", async () => {
    for (const role of ["owner", "principal", "admin", "accountant"] as const) {
      expect((await callAs(inst, role, recordInventoryMovement, mv("in", 10))).ok).toBe(true);
    }
    const { data, error } = await inst.clientAs("accountant").rpc("inventory_stock", { p_institution_id: inst.institutionId });
    expect(error).toBeNull();
    const row = data!.find((r: { item_id: string }) => r.item_id === itemId)!;
    expect(Number(row.on_hand)).toBe(40);
    expect(row.is_low_stock).toBe(false);
  });

  it("issue is stored negative and drops stock to low", async () => {
    expect((await callAs(inst, "admin", recordInventoryMovement, mv("issue", 36))).ok).toBe(true);
    const [m] = await sql`select quantity from public.inventory_movements where item_id = ${itemId} and kind = 'issue'`;
    expect(m!.quantity).toBe(-36);
    const { data } = await inst.clientAs("admin").rpc("inventory_stock", { p_institution_id: inst.institutionId });
    expect(data!.find((r: { item_id: string }) => r.item_id === itemId)!.is_low_stock).toBe(true);
  });

  it("issue beyond stock is refused and stock is unchanged", async () => {
    const r = await callAs(inst, "admin", recordInventoryMovement, mv("issue", 5));
    expect(r.ok).toBe(false);
    const adj = await callAs(inst, "admin", recordInventoryMovement, mv("adjust", -5));
    expect(adj.ok).toBe(false);
    const [s] = await sql`select coalesce(sum(quantity),0)::int as n from public.inventory_movements where item_id = ${itemId}`;
    expect(s!.n).toBe(4);
  });

  it("direct insert into movements is refused for every API role", async () => {
    for (const role of ["owner", "accountant"] as const) {
      const { error } = await inst
        .clientAs(role)
        .from("inventory_movements")
        .insert({ institution_id: inst.institutionId, item_id: itemId, kind: "in", quantity: 999, recorded_by: inst.users[role].id });
      expect(error).not.toBeNull();
    }
  });

  it("movements cannot be updated or deleted", async () => {
    await expect(sql`update public.inventory_movements set quantity = 1 where item_id = ${itemId}`).rejects.toThrow();
    await expect(sql`delete from public.inventory_movements where item_id = ${itemId}`).rejects.toThrow();
  });

  it("teacher is denied: action, rpc and reads", async () => {
    expect((await callAs(inst, "teacher", recordInventoryMovement, mv("in", 1))).ok).toBe(false);
    expect((await callAs(inst, "teacher", createInventoryItem, { name: "X", unit: "u", reorderLevel: 0 })).ok).toBe(false);
    const t = inst.clientAs("teacher");
    const rpc = await t.rpc("record_inventory_movement", { p_institution_id: inst.institutionId, p_item_id: itemId, p_kind: "in", p_quantity: 1 });
    expect(rpc.error).not.toBeNull();
    const rows = await t.from("inventory_items").select("id");
    expect(rows.data ?? []).toHaveLength(0);
    const stock = await t.rpc("inventory_stock", { p_institution_id: inst.institutionId });
    expect(stock.data ?? []).toHaveLength(0);
  });

  it("cross-tenant is refused", async () => {
    const r = await callAs(other, "admin", recordInventoryMovement, mv("in", 1));
    expect(r.ok).toBe(false);
    const rpc = await other.clientAs("admin").rpc("record_inventory_movement", { p_institution_id: inst.institutionId, p_item_id: itemId, p_kind: "in", p_quantity: 1 });
    expect(rpc.error).not.toBeNull();
    const stock = await other.clientAs("admin").rpc("inventory_stock", { p_institution_id: inst.institutionId });
    expect(stock.data ?? []).toHaveLength(0);
  });
});
