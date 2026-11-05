# Task 6 Report: M21-T6 Series builders

Packet: T-0NN M21-T6 Series builders
Files changed: `src/modules/forecasts/series.ts` (new), `tests/unit/forecasts-series.test.ts` (new)
Behavior implemented: `buildFeeSeries` (window_end<=asOf → periods, next ≤3 open rows → targets, seasonKey `t<sequence>`, billed map by start, null if no period or no target); `attendanceWindow`/`buildAttendanceSeries` (monday0 of asOf, 392d lookback, drop denominator-0 weeks, round2 rate, 3-Monday targets, stale (<monday0-28d) sections dropped, `attendance:school`/`attendance:section:<id>` keys, k=4); `isoWeek` (ISO 8601 week via Thursday method); `historyEvidence` (last ≤6 periods, billed only when present).
Tests run: `pnpm test tests/unit/forecasts-series.test.ts` → 12 passed. `pnpm lint src/modules/forecasts/series.ts tests/unit/forecasts-series.test.ts` → 0 errors. `pnpm typecheck` → clean.
Tests not run and why: none skipped; T3's SQL RPCs not merged in this tree (file has only T2 tables) so row shapes (`FeeSeriesRow`/`AttendanceSeriesRow`) are typed straight from rulings, not `types.ts`.
Limitations / honesty label: n/a (pure lib, no UI, no I/O).
Security / integration risks: none — pure TS, no DB/gateway calls.
Follow-ups: T7 job handler feeds real RPC rows into `buildFeeSeries`/`buildAttendanceSeries`, then `runSeries` (T5) and `historyEvidence` for the evidence jsonb; verify `FeeSeriesRow`/`AttendanceSeriesRow` against the merged migration once T3 lands (columns/order must match exactly).
New dependencies: none.
Assumptions made: RPC rows arrive pre-sorted by `starts_on`/`week_start` ascending (per rulings' own ordering) — no defensive sort added; `collected_paise`/`billed_paise`/`present`/`denominator` typed as `number` (bigint-safe at this scale), caller casts if the driver returns strings.
