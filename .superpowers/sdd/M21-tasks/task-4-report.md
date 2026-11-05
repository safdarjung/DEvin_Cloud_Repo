# Task 4 Report: M21-T4 Forecast schemas + constants

Packet: T-0NN M21-T4 Forecast schemas + constants

Files changed:
- `src/modules/forecasts/schemas.ts` (new)
- `tests/unit/forecasts-schemas.test.ts` (new)

Behavior implemented: Zod schemas and TypeScript types for forecast queries. Exports three const arrays (`FORECAST_KINDS`, `FORECAST_MODELS`, `FORECAST_UNITS`) with inferred types. Four schemas: `ForecastRunPayloadSchema` (as_of date), `ForecastCardsSchema` (empty), `FinanceSeriesSchema` (empty), `ForecastListSchema` (optional kind and classSectionId). All schemas are `.strict()` with inferred `…Input` types.

Tests run:
- `pnpm test tests/unit/forecasts-schemas.test.ts` → 17 passed (1 file)
- `pnpm lint src/modules/forecasts/schemas.ts tests/unit/forecasts-schemas.test.ts` → 0 errors
- `pnpm typecheck` → ✓ types generated successfully

Tests not run and why: none (all acceptance criteria met).

Limitations / honesty label: none.

Security / integration risks: none (pure schema validation, no side effects).

Follow-ups: M21-T5 (engine.ts) depends on the ForecastModel type for model selection.

New dependencies: none.

Assumptions made: `isoDate` from common.ts validates calendar dates (rejects 2026-02-30, requires YYYY-MM-DD format); `uuid` validates UUID format; `z.enum()` validates against const array membership.
