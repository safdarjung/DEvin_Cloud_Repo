// X07-T8 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/visitors.<fn> (mirrors src/modules/transport/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { GatePassListSchema, PickupListSchema, VisitorListSchema } from "./schemas";
import { visitorsGatePasses, visitorsList, visitorsPickupList } from "./queries";

export const visitorsListQuery = defineQuery({
  name: "visitors.list",
  module: "visitors",
  schema: VisitorListSchema,
  permission: "visitor.manage",
  handler: (input, ctx) => visitorsList(ctx, input),
});

export const visitorsGatePassesQuery = defineQuery({
  name: "visitors.gatePasses",
  module: "visitors",
  schema: GatePassListSchema,
  permission: "gatepass.manage",
  handler: (input, ctx) => visitorsGatePasses(ctx, input),
});

export const visitorsPickupListQuery = defineQuery({
  name: "visitors.pickupList",
  module: "visitors",
  schema: PickupListSchema,
  permission: "student.read",
  handler: (input, ctx) => visitorsPickupList(ctx, input.studentId),
});
