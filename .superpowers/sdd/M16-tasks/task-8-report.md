Packet: M16-T8 `dashboard.finance` + `dashboard.admissions`
Files changed: src/modules/core/dashboard-office.queries.ts (new); src/modules/core/query-defs.ts; src/modules/core/dashboard.queries.ts (export currentTermCollections); tests/db/dashboard-office.test.ts (new); tests/db/api-query-route.test.ts (smoke samples)
Behavior implemented:
- `financeDashboard(ctx)`: gates on `finance.read`; `collections` = `currentTermCollections(ctx)`; `overdue` = `listDefaulters` filtered `dueOn < today`, sorted outstanding desc, top 10. Null collections → `overdue: null` too.
- `admissionsDashboard(ctx)`: gates on `admissions.enquiry.read` + module `admissions`; `funnel` = `getAdmissionsFunnelCounts`; `recentEnquiries` = `listEnquiriesByStage` flattened, newest-first, top 5.
- Defs `dashboard.finance` / `dashboard.admissions` ({} strict, `dashboard.view`, module `core`) registered; smoke samples added.
Tests run (found already implemented from an interrupted earlier run; verified, not rewritten):
- `pnpm test:db tests/db/dashboard-office.test.ts` → 5 passed (5)
- `pnpm test:db tests/db/dashboard-queries.test.ts` → 8 passed (8)
- `pnpm test:db tests/db/api-query-route.test.ts` → 7 passed (7)
- `pnpm exec eslint` on all 5 touched files → clean
- `pnpm typecheck` → clean for touched files; pre-existing errors only in tests/db/attendance-trend.test.ts (not my file, other task in-flight)
Tests not run and why: full `pnpm test:db`/`pnpm lint` — lane rule (own files only).
Limitations / honesty label: none; no badge change.
Security / integration risks: none new — composers reuse existing RLS-scoped reads (`listDefaulters`, admissions queries); no new SQL.
Follow-ups: none.
New dependencies (justification): none
Assumptions made: prior interrupted run's implementation was already correct and complete per packet spec; verified via full test run rather than reimplementing.
