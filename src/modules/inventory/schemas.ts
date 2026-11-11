// Inventory — Zod schemas. Relative + .ts import: seed-script safe.
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

export const MOVEMENT_KINDS = ["in", "issue", "return", "adjust"] as const;

const name = z.string().trim().min(1).max(120);
const unit = z.string().trim().min(1).max(20);
const reorderLevel = z.number().int().min(0).max(1_000_000);

export const InventoryEmptySchema = z.object({}).strict();
export const InventoryItemCreateSchema = z.object({ name, unit, reorderLevel }).strict();
export const InventoryItemUpdateSchema = z.object({ id: uuid, name, unit, reorderLevel, isActive: z.boolean() }).strict();
export const InventoryMovementsQuerySchema = z.object({ itemId: uuid }).strict();

// in/issue/return: positive magnitude (issue is stored negative by the definer); adjust: signed, non-zero.
export const InventoryMovementSchema = z
  .object({
    itemId: uuid,
    kind: z.enum(MOVEMENT_KINDS),
    quantity: z.number().int().min(-1_000_000).max(1_000_000),
    note: z.string().trim().max(200).optional(),
  })
  .strict()
  .refine((d) => (d.kind === "adjust" ? d.quantity !== 0 : d.quantity > 0), {
    message: "Quantity must be positive (non-zero for adjust).",
    path: ["quantity"],
  });

export type InventoryItemCreateInput = z.infer<typeof InventoryItemCreateSchema>;
export type InventoryItemUpdateInput = z.infer<typeof InventoryItemUpdateSchema>;
export type InventoryMovementInput = z.infer<typeof InventoryMovementSchema>;
