Packet: M21-T9 Queries `forecasts.cards`, `forecasts.financeSeries`
Files changed: `src/modules/forecasts/queries.ts` (new); `src/modules/forecasts/query-defs.ts` (new); `tests/db/forecasts-queries.test.ts` (new); `src/app/api/v1/query/all-queries.ts` (+1 line, edit); `tests/db/api-query-route.test.ts` (+2 smoke samples, edit)
Behavior: `forecastCards(ctx)` reads horizon-1 rows for `attendance:school`/`fees:term` (RLS-filtered), emits in that fixed order, `current` = last `evidence.history` value (0 if empty), `direction` flat/up/down per ±2% rule. `financeSeries(ctx)` reads `fees:term` rows ordered by horizon; `[]` if none; else history points (low=high=collected, expected=billed) then one point per horizon (collected 0, expected=point, low/high=lower/upper), `month` = date.slice(0,7).
Tests run: re-verified 2026-11-05 (prior work found already committed, nothing left to implement) — `pnpm test:db tests/db/forecasts-queries.test.ts` -> 7/7 pass (principal cards order+direction, accountant fee-only, teacher [], guardian forbidden x2, financeSeries shape, no-fee -> []). `pnpm test:db tests/db/api-query-route.test.ts` -> 7/7 pass (smoke incl. both new queries). `pnpm lint` (touched files) -> clean. `pnpm typecheck` -> clean, no errors.
Tests not run: full `pnpm test:db`/`db:reset`/`seed` (not DB owner, brief forbids).
Limitations / honesty label: none here (LimitedBadge copy is T12 docs).
Security / integration risks: none — read-only, no writes; RLS (0094) is the only row filter, query layer adds no extra scoping (matches rulings).
Follow-ups: T10 (`forecasts.list`) already landed in same `queries.ts`/`query-defs.ts` (committed alongside T9); T3 no longer blocked (see task-3-report.md); T11 acceptance-over-HTTP can proceed.
New dependencies: none.
Assumptions made: `ForecastCard.unit`/fixture type accepts `"paise"|"pct"` (subset of its `"count"|"pct"|"paise"` union) — table never produces `"count"`.
