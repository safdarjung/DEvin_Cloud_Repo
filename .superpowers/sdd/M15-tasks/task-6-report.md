Packet: M15-T6 CSV text helper + source registry

Files changed:
- src/lib/http/csv-text.ts (new) — sanitizeCell/escapeFormula/rowsToCsvText
- src/lib/http/csv.ts (edit) — imports sanitizeCell from csv-text.ts, no behavior change
- src/modules/reports/sources.ts (new) — REPORT_SOURCES, runReportSource
- tests/unit/report-sources.test.ts (new)

Behavior implemented:
- rowsToCsvText(rows, columns?): sanitized cells (CSV-injection guard reused
  from csv.ts); columns fixes header order; 0 rows + columns = header-only
  line (Papa.unparse drops headers on empty arrays, so that case is
  special-cased via a single-row array-of-arrays trick).
- REPORT_SOURCES: closed allowlist for attendance.daily / finance.defaulters
  with permission, rpc name, Zod params schema, CSV columns, args() mapper.
- runReportSource: Object.hasOwn guard for unknown key, Zod parse before
  rpc, rpc error -> throw, success -> rows array.

Tests run: `pnpm test tests/unit/report-sources.test.ts tests/unit/api-query-csv.test.ts`
-> 2 files, 16 tests, all passed. `pnpm lint` clean. `pnpm typecheck` clean
(next typegen + tsc --noEmit, no errors).

Tests not run and why: tests/db/* (no DB access this lane, per brief —
DB owner elsewhere). test:security not run (no files touched that affect
RLS/escalation fixtures).

Limitations / honesty label: none — pure helper + registry, no UI, no AI
boundary, nothing simulated.

Security / integration risks: runReportSource trusts caller to pass the
right client (service-role for the job, caller's client for report.export)
per rulings — enforcing that split is T9/T10's job, not this one. args()
typed with `never`/cast to keep REPORT_SOURCES uniform across two param
shapes; each entry's own args() is still checked against its own params
type at definition site.

Follow-ups: none.

New dependencies (justification): none — papaparse already a dependency (M04).

Assumptions made: header-only-CSV-for-0-rows implemented via
Papa.unparse([[...columns]]) (treated as one data row of array type, so no
trailing newline) rather than hand-rolled quoting, to reuse Papa's escaping
rules for header names too.
