// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/behaviour.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { IncidentListSchema, PortalTimelineSchema } from "./schemas";
import { listIncidents, portalTimeline, studentPointTotals } from "./queries";

export const behaviourIncidentsQuery = defineQuery({
  name: "behaviour.incidents",
  module: "behaviour",
  schema: IncidentListSchema,
  permission: "behaviour.write",
  handler: (input, ctx) => listIncidents(ctx, input),
});

export const behaviourPointTotalsQuery = defineQuery({
  name: "behaviour.pointTotals",
  module: "behaviour",
  schema: IncidentListSchema,
  permission: "behaviour.write",
  handler: (input, ctx) => studentPointTotals(ctx, input),
});

export const behaviourTimelineQuery = defineQuery({
  name: "behaviour.timeline",
  module: "behaviour",
  schema: PortalTimelineSchema,
  permission: "behaviour.read",
  handler: (input, ctx) => portalTimeline(ctx, input.studentId),
});
