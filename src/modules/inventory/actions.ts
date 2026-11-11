"use server";

// Inventory actions (migration 0120). Movements go only through the definer
// record_inventory_movement (stock check + audit in SQL); items are plain RLS writes audited here.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { InventoryItemCreateSchema, InventoryItemUpdateSchema, InventoryMovementSchema } from "@/modules/inventory/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const createInventoryItem = defineAction({
  name: "inventory.item.create",
  module: "inventory",
  schema: InventoryItemCreateSchema,
  permission: "inventory.manage",
  handler: async ({ name, unit, reorderLevel }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("inventory_items")
      .insert({ institution_id: ctx.institution.id, name, unit, reorder_level: reorderLevel })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "inventory.item.create", entityType: "inventory_items", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateInventoryItem = defineAction({
  name: "inventory.item.update",
  module: "inventory",
  schema: InventoryItemUpdateSchema,
  permission: "inventory.manage",
  handler: async ({ id, name, unit, reorderLevel, isActive }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("inventory_items")
      .update({ name, unit, reorder_level: reorderLevel, is_active: isActive })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Item not found.");
    await audit(ctx, { action: "inventory.item.update", entityType: "inventory_items", entityId: id });
    return { id };
  },
});

export const recordInventoryMovement = defineAction({
  name: "inventory.movement.record",
  module: "inventory",
  schema: InventoryMovementSchema,
  permission: "inventory.manage",
  handler: async ({ itemId, kind, quantity, note }, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("record_inventory_movement", {
      p_institution_id: ctx.institution.id,
      p_item_id: itemId,
      p_kind: kind,
      p_quantity: quantity,
      p_note: note || undefined,
    });
    if (error) throwMapped(error);
    const row = data as { movement_id: string; on_hand: number } | null;
    if (!row) throw new AppError("internal", "Unexpected response shape.");
    return { movementId: row.movement_id, onHand: Number(row.on_hand) };
  },
});
