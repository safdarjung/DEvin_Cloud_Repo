Packet: M21-T10 Query `forecasts.list`
Files changed: `src/modules/forecasts/queries.ts` (edit, +`listForecasts`/`ForecastRow`); `src/modules/forecasts/query-defs.ts` (edit, +`forecastsListQuery`); `tests/db/forecasts-list.test.ts` (new); `tests/db/api-query-route.test.ts` (+1 smoke sample, edit).
Behavior: `listForecasts(ctx, {kind?, classSectionId?})` — one select over `forecasts` embedding `forecast_backtests(mape, n_train, holdout)` (composite FK) and `class_sections(name, grades(code))`; RLS (0094) is the only row scope, filters are optional `.eq`s. Maps to `ForecastRow` (`sectionLabel` = `"<grade code>-<name>"` or null school-wide), sorted in TS by kind asc, school-wide first, sectionLabel, horizon.
Tests run: `pnpm test:db tests/db/forecasts-list.test.ts` -> 5/5 pass (principal order+embed, kind filter, classSectionId filter, teacher taught-section-only, guardian forbidden). `pnpm test:db tests/db/api-query-route.test.ts` -> 7/7 pass (smoke incl. `forecasts.list`). Regression: `pnpm test:db tests/db/forecasts-queries.test.ts tests/db/forecasts-rls.test.ts` -> 17/17 pass. `pnpm lint` (4 touched files) -> clean. `pnpm typecheck` -> clean, whole repo.
Tests not run: full `pnpm test:db`/`db:reset`/`seed` (not DB owner, brief forbids).
Limitations / honesty label: none here (LimitedBadge copy is T12 docs).
Security / integration risks: none — read-only, no new writes; RLS is the only row filter, query adds no extra scoping (matches rulings).
Follow-ups: T11 acceptance-over-HTTP will exercise `forecasts.list` via the real job once T3/T7/T8 land (T3 BLOCKED per task-3-report.md, unrelated to this task).
New dependencies: none.
Assumptions made: no partial edits found for this task in the tree at start (T9's files only); `kind` sort order is plain ascending string compare on the column value (matches cards' attendance-then-fees convention, since "attendance_rate_week" < "fee_collections_term").
