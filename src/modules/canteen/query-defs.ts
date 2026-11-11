// Features-18 #10 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/canteen.<fn>. RLS scopes every row to the caller.
import { defineQuery } from "@/lib/actions/define-query";
import { CanteenDaySalesSchema, CanteenItemListSchema, CanteenStatementSchema } from "./schemas";
import { canteenDaySales, canteenItems, canteenStatement } from "./queries";

/** Canteen menu: item names, prices (paise) and on-sale flag. Name-free. */
export const canteenItemsQuery = defineQuery({
  name: "canteen.items",
  module: "canteen",
  schema: CanteenItemListSchema,
  permission: "canteen.read",
  handler: (input, ctx) => canteenItems(ctx, input),
});

/** One student's canteen balance (canteen_balance) and last 50 top-ups/purchases. Person-scoped. */
export const canteenStatementQuery = defineQuery({
  name: "canteen.statement",
  module: "canteen",
  schema: CanteenStatementSchema,
  permission: "canteen.read",
  handler: (input, ctx) => canteenStatement(ctx, input.studentId),
});

/** Day totals: sales by item and simulated top-ups for one school day (default today). Name-free. */
export const canteenDaySalesQuery = defineQuery({
  name: "canteen.daySales",
  module: "canteen",
  schema: CanteenDaySalesSchema,
  permission: "canteen.read",
  handler: (input, ctx) => canteenDaySales(ctx, input),
});
