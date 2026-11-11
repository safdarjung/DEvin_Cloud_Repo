// Features-18 #10 — canteen Zod schemas. Bounds mirror migration 0119's
// definers and checks (money is always integer paise). Relative + .ts
// import: seed-script safe.
import { z } from "zod";
import { isoDate, uuid } from "../../lib/schemas/common.ts";

export const CANTEEN_TOPUP_MIN_PAISE = 100;
export const CANTEEN_TOPUP_MAX_PAISE = 1_000_000;
export const CANTEEN_PRICE_MAX_PAISE = 100_000;
export const CANTEEN_QUANTITY_MAX = 20;

const itemName = z.string().trim().min(1).max(80);
const pricePaise = z.number().int().min(1).max(CANTEEN_PRICE_MAX_PAISE);

export const CanteenItemCreateSchema = z.object({ name: itemName, pricePaise }).strict();
export type CanteenItemCreateInput = z.infer<typeof CanteenItemCreateSchema>;

export const CanteenItemUpdateSchema = z
  .object({ id: uuid, name: itemName.optional(), pricePaise: pricePaise.optional(), isActive: z.boolean().optional() })
  .strict()
  .refine((d) => d.name !== undefined || d.pricePaise !== undefined || d.isActive !== undefined, {
    message: "Change at least one of name, price or on-sale",
    path: ["id"],
  });
export type CanteenItemUpdateInput = z.infer<typeof CanteenItemUpdateSchema>;

// Simulated: no payment is taken (UI shows <SimulatedBadge />).
export const CanteenTopupSchema = z
  .object({
    studentId: uuid,
    amountPaise: z.number().int().min(CANTEEN_TOPUP_MIN_PAISE).max(CANTEEN_TOPUP_MAX_PAISE),
    note: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type CanteenTopupInput = z.infer<typeof CanteenTopupSchema>;

// .strict(): the caller can never send a price — canteen_purchase reads it from the item.
export const CanteenPurchaseSchema = z
  .object({ studentId: uuid, itemId: uuid, quantity: z.number().int().min(1).max(CANTEEN_QUANTITY_MAX) })
  .strict();
export type CanteenPurchaseInput = z.infer<typeof CanteenPurchaseSchema>;

export const CanteenItemListSchema = z.object({ includeInactive: z.boolean().optional() }).strict();
export type CanteenItemListInput = z.infer<typeof CanteenItemListSchema>;

export const CanteenStatementSchema = z.object({ studentId: uuid }).strict();
export type CanteenStatementInput = z.infer<typeof CanteenStatementSchema>;

export const CanteenDaySalesSchema = z.object({ date: isoDate.optional() }).strict();
export type CanteenDaySalesInput = z.infer<typeof CanteenDaySalesSchema>;
