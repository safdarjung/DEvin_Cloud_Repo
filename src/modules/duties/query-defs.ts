// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/duties.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { dutyCountByType, dutyRoster, dutyTypes } from "./queries";
import { DutyEmptySchema, DutyRangeSchema } from "./schemas";

export const dutyTypesQuery = defineQuery({
  name: "duties.types",
  module: "duties",
  schema: DutyEmptySchema,
  permission: "duty.read",
  handler: (_input, ctx) => dutyTypes(ctx),
});

/** Roster rows with staff names (local-only for AI). */
export const dutyRosterQuery = defineQuery({
  name: "duties.roster",
  module: "duties",
  schema: DutyRangeSchema,
  permission: "duty.read",
  handler: (input, ctx) => dutyRoster(ctx, input.from, input.to),
});

/** Name-free aggregate: duty count per duty type for a date range. */
export const dutyCountByTypeQuery = defineQuery({
  name: "duties.countByType",
  module: "duties",
  schema: DutyRangeSchema,
  permission: "duty.read",
  handler: (input, ctx) => dutyCountByType(ctx, input.from, input.to),
});
