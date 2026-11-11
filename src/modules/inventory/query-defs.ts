// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/inventory.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { InventoryEmptySchema, InventoryMovementsQuerySchema } from "./schemas";
import { inventoryLowStockCount, inventoryMovements, inventoryStock } from "./queries";

export const inventoryStockQuery = defineQuery({
  name: "inventory.stock",
  module: "inventory",
  schema: InventoryEmptySchema,
  permission: "inventory.read",
  handler: (_input, ctx) => inventoryStock(ctx),
});

export const inventoryMovementsQuery = defineQuery({
  name: "inventory.movements",
  module: "inventory",
  schema: InventoryMovementsQuerySchema,
  permission: "inventory.read",
  handler: (input, ctx) => inventoryMovements(ctx, input.itemId),
});

export const inventoryLowStockCountQuery = defineQuery({
  name: "inventory.lowStockCount",
  module: "inventory",
  schema: InventoryEmptySchema,
  permission: "inventory.read",
  handler: (_input, ctx) => inventoryLowStockCount(ctx),
});
