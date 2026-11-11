"use server";

// Features-18 #10 — canteen writes (migration 0119). Menu items are plain
// RLS-guarded table writes; money moves only through the definers
// canteen_topup / canteen_purchase, which re-check the role, bind the
// student/item to the institution, read the price from the item, refuse an
// overdraft under a per-student lock, and write their own app.audit row —
// so those two actions do not call audit() again. Never AI-draftable (§E).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  CanteenItemCreateSchema,
  CanteenItemUpdateSchema,
  CanteenPurchaseSchema,
  CanteenTopupSchema,
  type CanteenItemCreateInput,
  type CanteenItemUpdateInput,
  type CanteenPurchaseInput,
  type CanteenTopupInput,
} from "@/modules/canteen/schemas";

export interface CanteenMoneyResult {
  transactionId: string;
  balancePaise: number;
}

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function toMoneyResult(data: unknown): CanteenMoneyResult {
  const row = data as { transaction_id: string; balance_paise: number };
  return { transactionId: row.transaction_id, balancePaise: Number(row.balance_paise) };
}

export const createCanteenItem = defineAction({
  name: "canteen.item.create",
  module: "canteen",
  schema: CanteenItemCreateSchema,
  permission: "canteen.manage",
  handler: async ({ name, pricePaise }: CanteenItemCreateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("canteen_items")
      .insert({ institution_id: ctx.institution.id, name, price_paise: pricePaise })
      .select("id")
      .single();
    if (error) throwMapped(error);

    await audit(ctx, { action: "canteen.item.create", entityType: "canteen_items", entityId: data.id, after: { price_paise: pricePaise } });
    return { id: data.id as string };
  },
});

export const updateCanteenItem = defineAction({
  name: "canteen.item.update",
  module: "canteen",
  schema: CanteenItemUpdateSchema,
  permission: "canteen.manage",
  handler: async ({ id, name, pricePaise, isActive }: CanteenItemUpdateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("canteen_items")
      .update({ name, price_paise: pricePaise, is_active: isActive })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id, price_paise, is_active")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Menu item not found.");

    await audit(ctx, {
      action: "canteen.item.update",
      entityType: "canteen_items",
      entityId: data.id,
      after: { price_paise: data.price_paise, is_active: data.is_active },
    });
    return { id: data.id as string };
  },
});

export const topupCanteen = defineAction({
  name: "canteen.topup",
  module: "canteen",
  schema: CanteenTopupSchema,
  permission: "canteen.manage",
  handler: async ({ studentId, amountPaise, note }: CanteenTopupInput, ctx): Promise<CanteenMoneyResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("canteen_topup", {
      p_institution_id: ctx.institution.id,
      p_student_id: studentId,
      p_amount_paise: amountPaise,
      p_note: note,
    });
    if (error) throwMapped(error);
    return toMoneyResult(data);
  },
});

export const purchaseCanteen = defineAction({
  name: "canteen.purchase",
  module: "canteen",
  schema: CanteenPurchaseSchema,
  permission: "canteen.manage",
  handler: async ({ studentId, itemId, quantity }: CanteenPurchaseInput, ctx): Promise<CanteenMoneyResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("canteen_purchase", {
      p_institution_id: ctx.institution.id,
      p_student_id: studentId,
      p_item_id: itemId,
      p_quantity: quantity,
    });
    if (error) throwMapped(error);
    return toMoneyResult(data);
  },
});
