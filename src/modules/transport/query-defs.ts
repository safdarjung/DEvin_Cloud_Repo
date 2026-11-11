// M13-T9 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/transport.<fn> (mirrors src/modules/timetable/query-defs.ts).
// Lane B ruling (M13-tasks.md header): no `module` field here — MOD's
// retrofit adds it after this worktree merges.
import { defineQuery } from "@/lib/actions/define-query";
import { TransportForStudentSchema, TransportRoutesSchema, TransportVehiclesSchema } from "./schemas";
import { transportForStudent, transportRoutes, transportVehicles } from "./queries";

export const transportRoutesQuery = defineQuery({
  name: "transport.routes",
  module: "transport",
  schema: TransportRoutesSchema,
  permission: "transport.manage",
  handler: (_input, ctx) => transportRoutes(ctx),
});

export const transportVehiclesQuery = defineQuery({
  name: "transport.vehicles",
  module: "transport",
  schema: TransportVehiclesSchema,
  permission: "transport.manage",
  handler: (_input, ctx) => transportVehicles(ctx),
});

export const transportForStudentQuery = defineQuery({
  name: "transport.forStudent",
  module: "transport",
  schema: TransportForStudentSchema,
  permission: "student.read",
  handler: (input, ctx) => transportForStudent(ctx, input.studentId),
});
