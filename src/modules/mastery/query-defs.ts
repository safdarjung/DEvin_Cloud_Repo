// M20-T8 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/mastery.<fn> (mirrors src/modules/timetable/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { HeatmapQuerySchema, InterventionsQuerySchema, StudentGapsQuerySchema, SuccessRowsQuerySchema } from "./schemas";
import { masteryGapsForStudent, masteryHeatmap, masteryInterventions, masteryStudentSuccessRows } from "./queries";

export const masteryHeatmapBySectionQuery = defineQuery({
  name: "mastery.heatmapBySection",
  module: "mastery",
  schema: HeatmapQuerySchema,
  permission: "mastery.review",
  handler: (input, ctx) => masteryHeatmap(ctx, input),
});

export const masteryGapsForStudentQuery = defineQuery({
  name: "mastery.gapsForStudent",
  module: "mastery",
  schema: StudentGapsQuerySchema,
  permission: "mastery.read",
  handler: (input, ctx) => masteryGapsForStudent(ctx, input.studentId),
});

export const masteryStudentSuccessRowsQuery = defineQuery({
  name: "mastery.studentSuccessRows",
  module: "mastery",
  schema: SuccessRowsQuerySchema,
  permission: "mastery.review",
  handler: (input, ctx) => masteryStudentSuccessRows(ctx, input.classSectionId),
});

export const masteryInterventionsQuery = defineQuery({
  name: "mastery.interventions",
  module: "mastery",
  schema: InterventionsQuerySchema,
  permission: "mastery.review",
  handler: (input, ctx) => masteryInterventions(ctx, input),
});
