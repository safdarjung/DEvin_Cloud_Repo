// M13-T8 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/facilities.<fn> (mirrors src/modules/timetable/query-defs.ts).
// Lane B ruling: no `module` field (MOD unmerged in this worktree).
import { defineQuery } from "@/lib/actions/define-query";
import { AssetListSchema, MaintenanceListSchema } from "./schemas";
import { facilitiesAssets, facilitiesMaintenanceRequests } from "./queries";

export const facilitiesAssetsQuery = defineQuery({
  name: "facilities.assets",
  schema: AssetListSchema,
  permission: "maintenance.request",
  handler: (input, ctx) => facilitiesAssets(ctx, input),
});

export const facilitiesMaintenanceRequestsQuery = defineQuery({
  name: "facilities.maintenanceRequests",
  schema: MaintenanceListSchema,
  permission: "maintenance.request",
  handler: (input, ctx) => facilitiesMaintenanceRequests(ctx, input),
});
