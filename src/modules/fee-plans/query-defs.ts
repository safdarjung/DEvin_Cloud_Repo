// X04-T6 — read-only wrappers for ./queries.ts, exposed at
// /api/v1/query/feePlans.<fn>. defineQuery adds Zod input validation + a
// permission gate; RLS stays the actual data filter. Mirrors
// src/modules/finance/query-defs.ts.
import { defineQuery } from "@/lib/actions/define-query";
import { InstalmentsQuerySchema, LateFeeRulesQuerySchema, LedgerExportSchema } from "./schemas";
import { getInstalments, ledgerExport, listLateFeeRules } from "./queries";

// permission: finance.structure.manage — same holders as the
// ledger/defaulters reports (X04 ruling "Permissions").
export const lateFeeRulesQuery = defineQuery({
  name: "feePlans.lateFeeRules",
  module: "fee_plans",
  schema: LateFeeRulesQuerySchema,
  permission: "finance.structure.manage",
  handler: (_input, ctx) => listLateFeeRules(ctx),
});

// permission: finance.read — guardian/student own scope; RLS on
// invoice_instalments/late_fee_charges does the actual filtering (X04
// ruling "Permissions").
export const instalmentsQuery = defineQuery({
  name: "feePlans.instalments",
  module: "fee_plans",
  schema: InstalmentsQuerySchema,
  permission: "finance.read",
  handler: (input, ctx) => getInstalments(ctx, { invoiceId: input.invoiceId }),
});

// permission: finance.structure.manage — same holders as ledger RLS (X04
// ruling "Permissions").
export const ledgerExportQuery = defineQuery({
  name: "feePlans.ledgerExport",
  module: "fee_plans",
  schema: LedgerExportSchema,
  permission: "finance.structure.manage",
  handler: (input, ctx) => ledgerExport(ctx, input),
});
