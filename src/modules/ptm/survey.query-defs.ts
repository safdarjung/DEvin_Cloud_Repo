// X08-T8 — read-only wrappers over ./survey.queries.ts, exposed at
// /api/v1/query/survey.<fn> (mirrors src/modules/timetable/query-defs.ts).
import { defineQuery } from "@/lib/actions/define-query";
import { MySurveysSchema, SurveyListSchema, SurveyResultsSchema } from "./schemas";
import { surveyList, surveyMine, surveyResults } from "./survey.queries";

export const surveyListQuery = defineQuery({
  name: "survey.list",
  module: "ptm",
  schema: SurveyListSchema,
  permission: "survey.manage",
  handler: (input, ctx) => surveyList(ctx, input.status),
});

export const surveyResultsQuery = defineQuery({
  name: "survey.results",
  module: "ptm",
  schema: SurveyResultsSchema,
  permission: "survey.manage",
  handler: (input) => surveyResults(input.surveyId),
});

export const surveyMineQuery = defineQuery({
  name: "survey.mine",
  module: "ptm",
  schema: MySurveysSchema,
  permission: "survey.respond",
  handler: (_input, ctx) => surveyMine(ctx),
});
