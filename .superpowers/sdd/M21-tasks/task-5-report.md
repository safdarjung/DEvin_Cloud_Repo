# Task 5 Report: M21-T5 Forecast engine

Packet: T-0NN M21-T5 Forecast engine
Files changed: `src/modules/forecasts/engine.ts` (new), `tests/unit/forecasts-engine.test.ts` (new)
Behavior implemented: pure deterministic engine — `predict` (moving_average_v1 flat-k-mean, seasonal_naive_v1 latest same-seasonKey scan), `mape` (skips zero-actual pairs, round4, null if none), `runSeries` (single-origin backtest per model with HOLDOUT=3, eligibility = has backtest + predicts every target, lowest MAPE wins ties to earlier model, horizon band = point*mape*sqrt(h), pct capped at 100, paise rounded int / pct 2dp, confidence = round3(clamp(1-mape,0,1))).
Tests run: `pnpm test tests/unit/forecasts-engine.test.ts` → 16 passed (RED confirmed first: module-not-found before engine.ts existed). `pnpm lint` (both files) → 0 errors. `pnpm typecheck` → clean.
Tests not run and why: none skipped.
Limitations / honesty label: n/a (pure lib, no UI).
Security / integration risks: none — pure TS, no I/O, no DB/gateway calls.
Follow-ups: T6 series builders (fees k=2, attendance k=4) feed real `Period`/`Target` into `runSeries`; T7 wires job handler.
New dependencies: none.
Assumptions made: `originStart` = last training period's `start`; band computed from uncapped point, then point/upper capped for `pct`; tie-break uses strict `<` so first-found (moving_average_v1) wins equal MAPE, per model order.
