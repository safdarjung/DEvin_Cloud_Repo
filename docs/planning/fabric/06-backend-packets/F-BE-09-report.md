# F-BE-09: finance-intel fixture

**Files:** `src/modules/fabric/demo/finance-intel.ts`, `tests/unit/fabric-fixtures/finance-intel.test.ts`

**Implemented:**
- `financeForecast()`: 12 months (6 past with collected>0, 6 future with collected=0 and widening bands)
- `outstandingAlerts()`: 25 deterministic alerts, days_overdue 5–120, ~15% with concession
- `budgetLines()`: 10 categories, variance_pct computed from actuals

**Tests:** 20 passing. Verify determinism, counts, bounds, integer paise, past/future month behavior.

**Typecheck/Lint:** Clean (pre-existing syntax error in agents.ts ignored per BRIEF-COMMON.md §12).

**Run:** `pnpm test tests/unit/fabric-fixtures/finance-intel.test.ts` → **PASS**
