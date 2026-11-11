// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/compliance.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { complianceItems, complianceSummary } from "./queries";
import { ComplianceEmptySchema, ComplianceListSchema } from "./schemas";

/** Name-free aggregate: counts by category and computed status. */
export const complianceSummaryQuery = defineQuery({
  name: "compliance.summary",
  module: "compliance",
  schema: ComplianceEmptySchema,
  permission: "compliance.read",
  handler: (_input, ctx) => complianceSummary(ctx),
});

/** Items with computed status (includes owner staff name: local-only for AI). */
export const complianceItemsQuery = defineQuery({
  name: "compliance.items",
  module: "compliance",
  schema: ComplianceListSchema,
  permission: "compliance.read",
  handler: (input, ctx) => complianceItems(ctx, input),
});
