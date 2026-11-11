// features-18 §D — /api/v1/query/lab.* over ./lab.queries.ts (mirrors
// src/modules/forecasts/query-defs.ts). 0125 is security invoker, so RLS
// narrows every read; insight.read + insight.review (requireLabAccess) is the floor.
import { defineQuery } from "@/lib/actions/define-query";
import { LabQuerySchema } from "./lab.schemas";
import { labCorrelation, labFeeRiskCohorts, labSectionAnomalies, labTrendBreaks } from "./lab.queries";

export const labCorrelationQuery = defineQuery({
  name: "lab.correlation",
  module: "insights",
  schema: LabQuerySchema,
  permission: "insight.review", // + insight.read inside requireLabAccess
  handler: (_input, ctx) => labCorrelation(ctx),
});

export const labAnomaliesQuery = defineQuery({
  name: "lab.anomalies",
  module: "insights",
  schema: LabQuerySchema,
  permission: "insight.review", // + insight.read inside requireLabAccess
  handler: (_input, ctx) => labSectionAnomalies(ctx),
});

export const labFeeRiskQuery = defineQuery({
  name: "lab.feeRisk",
  module: "insights",
  schema: LabQuerySchema,
  permission: "insight.review", // + insight.read inside requireLabAccess
  handler: (_input, ctx) => labFeeRiskCohorts(ctx),
});

export const labTrendBreaksQuery = defineQuery({
  name: "lab.trendBreaks",
  module: "insights",
  schema: LabQuerySchema,
  permission: "insight.review", // + insight.read inside requireLabAccess
  handler: (_input, ctx) => labTrendBreaks(ctx),
});
