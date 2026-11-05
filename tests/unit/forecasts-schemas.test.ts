import { describe, it, expect } from "vitest";
import {
  FORECAST_KINDS,
  FORECAST_MODELS,
  FORECAST_UNITS,
  ForecastRunPayloadSchema,
  ForecastCardsSchema,
  FinanceSeriesSchema,
  ForecastListSchema,
} from "../../src/modules/forecasts/schemas";

describe("Forecast schemas", () => {
  describe("constants", () => {
    it("exports FORECAST_KINDS", () => {
      expect(FORECAST_KINDS).toEqual([
        "fee_collections_term",
        "attendance_rate_week",
      ]);
    });

    it("exports FORECAST_MODELS", () => {
      expect(FORECAST_MODELS).toEqual([
        "moving_average_v1",
        "seasonal_naive_v1",
      ]);
    });

    it("exports FORECAST_UNITS", () => {
      expect(FORECAST_UNITS).toEqual(["paise", "pct"]);
    });
  });

  describe("ForecastRunPayloadSchema", () => {
    it("accepts valid as_of date", () => {
      const result = ForecastRunPayloadSchema.safeParse({
        as_of: "2026-11-04",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.as_of).toBe("2026-11-04");
      }
    });

    it("rejects invalid date 2026-02-30", () => {
      const result = ForecastRunPayloadSchema.safeParse({
        as_of: "2026-02-30",
      });
      expect(result.success).toBe(false);
    });

    it("rejects malformed date 2026-11-2", () => {
      const result = ForecastRunPayloadSchema.safeParse({
        as_of: "2026-11-2",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const result = ForecastRunPayloadSchema.safeParse({
        as_of: "2026-11-04",
        extra: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ForecastCardsSchema", () => {
    it("accepts empty object", () => {
      const result = ForecastCardsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const result = ForecastCardsSchema.safeParse({
        unknown: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("FinanceSeriesSchema", () => {
    it("accepts empty object", () => {
      const result = FinanceSeriesSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejects unknown keys", () => {
      const result = FinanceSeriesSchema.safeParse({
        unknown: "field",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("ForecastListSchema", () => {
    it("accepts empty object", () => {
      const result = ForecastListSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts valid kind", () => {
      const result = ForecastListSchema.safeParse({
        kind: "fee_collections_term",
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid classSectionId uuid", () => {
      const result = ForecastListSchema.safeParse({
        classSectionId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown kind", () => {
      const result = ForecastListSchema.safeParse({
        kind: "unknown_kind",
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-uuid classSectionId", () => {
      const result = ForecastListSchema.safeParse({
        classSectionId: "not-a-uuid",
      });
      expect(result.success).toBe(false);
    });

    it("rejects unknown keys", () => {
      const result = ForecastListSchema.safeParse({
        unknown: "field",
      });
      expect(result.success).toBe(false);
    });
  });
});
