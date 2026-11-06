// M21-T9 — read-only wrappers over ./queries.ts, exposed at
// /api/v1/query/forecasts.<fn> (mirrors src/modules/timetable/query-defs.ts).
// RLS (0094) does the real narrowing; permission check is forecast.read.
import { defineQuery } from "@/lib/actions/define-query";
import { ForecastCardsSchema, FinanceSeriesSchema, ForecastListSchema } from "./schemas";
import { forecastCards, financeSeries, listForecasts } from "./queries";

export const forecastsCardsQuery = defineQuery({
  name: "forecasts.cards",
  module: "forecasts",
  schema: ForecastCardsSchema,
  permission: "forecast.read",
  handler: (_input, ctx) => forecastCards(ctx),
});

export const forecastsFinanceSeriesQuery = defineQuery({
  name: "forecasts.financeSeries",
  module: "forecasts",
  schema: FinanceSeriesSchema,
  permission: "forecast.read",
  handler: (_input, ctx) => financeSeries(ctx),
});

export const forecastsListQuery = defineQuery({
  name: "forecasts.list",
  module: "forecasts",
  schema: ForecastListSchema,
  permission: "forecast.read",
  handler: (input, ctx) => listForecasts(ctx, input),
});
