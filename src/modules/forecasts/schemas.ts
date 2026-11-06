// M21-T4 — Zod schemas for forecasts.* queries. Relative .ts import (seed-script safe).
import { z } from "zod";
import { uuid, isoDate } from "../../lib/schemas/common.ts";

export const FORECAST_KINDS = [
  "fee_collections_term",
  "attendance_rate_week",
] as const;
export type ForecastKind = (typeof FORECAST_KINDS)[number];

export const FORECAST_MODELS = [
  "moving_average_v1",
  "seasonal_naive_v1",
] as const;
export type ForecastModel = (typeof FORECAST_MODELS)[number];

export const FORECAST_UNITS = ["paise", "pct"] as const;
export type ForecastUnit = (typeof FORECAST_UNITS)[number];

export const ForecastRunPayloadSchema = z
  .object({
    as_of: isoDate,
  })
  .strict();
export type ForecastRunPayloadInput = z.infer<typeof ForecastRunPayloadSchema>;

export const ForecastCardsSchema = z.object({}).strict();
export type ForecastCardsInput = z.infer<typeof ForecastCardsSchema>;

export const FinanceSeriesSchema = z.object({}).strict();
export type FinanceSeriesInput = z.infer<typeof FinanceSeriesSchema>;

export const ForecastListSchema = z
  .object({
    kind: z.enum(FORECAST_KINDS).optional(),
    classSectionId: uuid.optional(),
  })
  .strict();
export type ForecastListInput = z.infer<typeof ForecastListSchema>;
