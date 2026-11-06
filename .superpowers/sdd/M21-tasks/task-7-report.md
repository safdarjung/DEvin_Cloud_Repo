Packet: M21-T7 Job `forecast.run`
Files changed: `src/modules/jobs/handlers/forecast.run.ts` (new); `tests/helpers/forecast-fixtures.ts` (new); `tests/db/forecast-run-job.test.ts` (new); `src/modules/jobs/handlers/index.ts`, `src/modules/jobs/registry.ts`, `src/modules/jobs/types.ts` (edit: export/registry/JobType/JOB_MODULES entries).
Behavior implemented: `forecastRun` — validates payload (ForecastRunPayloadSchema), skips late replay (`max(as_of)` > payload), pulls both T3 RPCs via admin, builds specs with T6 builders, runs T5 engine per spec, batch-upserts `forecast_backtests` then `forecasts` (backtest_id from the upsert's returned ids), then deletes both tables' rows `as_of <` this run (forecasts first). `seedForecastHistory(inst)` seeds 3 academic years/9 terms with a strong t1≫t2>t3 fee pattern and 10 weeks of flat-rate daily attendance, relative to today (Asia/Kolkata); returns `{asOf, feeHorizons}`.
Tests run: RED confirmed (file didn't exist) → `pnpm test:db tests/db/forecast-run-job.test.ts`: 1 file, 7/7 pass → `pnpm test:db tests/db/jobs.test.ts`: 11/11 pass (first pass hit the same concurrent-lane 5s timeout T2 noted; clean retry, no code change) → `pnpm test tests/unit/jobs-runner.test.ts`: 37/37 pass → `pnpm lint` (whole project): clean → `pnpm typecheck` (whole project): clean.
Tests not run and why: none skipped.
Limitations / honesty label: n/a (no UI; label is T12/docs).
Security / integration risks: none found — service-role only, no new RLS surface; handler never echoes `job.payload` in errors/logs, only `job.id` + counts.
Follow-ups: T11 acceptance-over-HTTP will exercise this end to end via the sweep (T8, concurrent lane) + runner.
New dependencies: none.
Assumptions made: evidence `origin.label` falls back to `origin.start` if no matching period (shouldn't occur, defensive only); `forecast.run` confidence/evidence cast through `NonNullable<Json>` (generated types reject plain `unknown`/`Record`).
