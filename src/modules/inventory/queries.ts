import "server-only";
// Inventory reads — always the signed-in user's RLS client (owner/principal/admin/accountant).
// Stock comes only from public.inventory_stock; never summed client-side.
import { createClient } from "@/lib/supabase/server";
import { AppError, mapSqlError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";

const MOVEMENT_LIMIT = 200;

function check(error: unknown): void {
  if (!error) return;
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface InventoryStockRow {
  itemId: string;
  name: string;
  unit: string;
  reorderLevel: number;
  isActive: boolean;
  onHand: number;
  isLowStock: boolean;
}

export interface InventoryMovementRow {
  id: string;
  kind: string;
  quantity: number;
  note: string | null;
  createdAt: string;
}

export async function inventoryStock(ctx: TenantContext): Promise<InventoryStockRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("inventory_stock", { p_institution_id: ctx.institution.id });
  check(error);
  return (data ?? []).map((r) => ({
    itemId: r.item_id,
    name: r.name,
    unit: r.unit,
    reorderLevel: r.reorder_level,
    isActive: r.is_active,
    onHand: Number(r.on_hand),
    isLowStock: r.is_low_stock,
  }));
}

export async function inventoryMovements(ctx: TenantContext, itemId: string): Promise<InventoryMovementRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_movements")
    .select("id, kind, quantity, note, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(MOVEMENT_LIMIT);
  check(error);
  return (data ?? []).map((r) => ({ id: r.id, kind: r.kind, quantity: r.quantity, note: r.note, createdAt: r.created_at }));
}

/** Name-free aggregate: how many active items are at or below reorder level. */
export async function inventoryLowStockCount(ctx: TenantContext): Promise<number> {
  return (await inventoryStock(ctx)).filter((r) => r.isActive && r.isLowStock).length;
}
