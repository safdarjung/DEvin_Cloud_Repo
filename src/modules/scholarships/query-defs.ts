// Features-18 #9 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/scholarships.<fn>. Name-free aggregate: scholarships.summary.
// scholarships.awards carries student names; scholarships.rules carries none
// but is configuration, not an aggregate.
import { defineQuery } from "@/lib/actions/define-query";
import { ConcessionAwardListSchema, ConcessionRuleListSchema, ConcessionSummarySchema } from "./schemas";
import { concessionAwards, concessionRules, concessionSummary } from "./queries";

/** Concession rules: name, criteria, percent or fixed amount, active flag. */
export const concessionRulesQuery = defineQuery({
  name: "scholarships.rules",
  module: "scholarships",
  schema: ConcessionRuleListSchema,
  permission: "concession.read",
  handler: (input, ctx) => concessionRules(ctx, input),
});

/** Concession awards newest first (student, rule, value, status, requester, decision), filterable by status. */
export const concessionAwardsQuery = defineQuery({
  name: "scholarships.awards",
  module: "scholarships",
  schema: ConcessionAwardListSchema,
  permission: "concession.read",
  handler: (input, ctx) => concessionAwards(ctx, input),
});

/** Award counts by status and approved concession value by rule and by grade (no names). */
export const concessionSummaryQuery = defineQuery({
  name: "scholarships.summary",
  module: "scholarships",
  schema: ConcessionSummarySchema,
  permission: "concession.read",
  handler: (_input, ctx) => concessionSummary(ctx),
});
