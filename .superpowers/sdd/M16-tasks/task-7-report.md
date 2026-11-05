Packet: M16-T7 `dashboard.principal` + `dashboard.operations`
Files changed: src/modules/core/dashboard-leader.queries.ts (new); src/modules/core/query-defs.ts; tests/db/dashboard-leader.test.ts (new); tests/db/api-query-route.test.ts (smoke samples)
Behavior implemented: `principalDashboard(ctx)` = `getDashboardData` + `attendanceTrend(ctx,{days:42})` (null w/o `attendance.read`) + `pendingApprovals(ctx)` + `staffAvailabilityToday` (null w/o `staff.read`+`staff_attendance`). `operationsDashboard(ctx)` = same `staffToday`; `coverNeeded` = `timetableCoverNeeded` filtered to `substitution===null` rows (null w/o `timetable.manage`+`substitution`); `openMaintenance` = `facilitiesMaintenanceRequests({status:"open",limit:5})` (null w/o `maintenance.request`+`facilities`); `upcomingEvents` = first 5 of `calendarForRole(ctx,{})` (null w/o `academics.read`+`calendar`). Defs `dashboard.principal`/`dashboard.operations` ({} strict, `dashboard.view`, module `core`); smoke samples added.
Tests run: `pnpm test:db tests/db/dashboard-leader.test.ts` → 6/6 pass. `pnpm test:db tests/db/api-query-route.test.ts` → 7/7 pass. `pnpm exec eslint` on 4 touched files → clean. `pnpm typecheck` → clean, whole project.
Tests not run and why: full `test:db`/`pnpm lint`/security — lane rule (own files only).
Limitations / honesty label: none; no UI/badge change (page swap is a later task).
Security / integration risks: none new — all sub-reads are existing RLS-scoped functions, no new SQL; each field gated on its own permission+module before the sub-read runs.
Follow-ups: none for this task; `dashboard/page.tsx` leader-branch swap to these composers is a separate later task per rulings "Page swaps".
New dependencies: none.
Assumptions made: no partial edits existed for T7's files (fresh start, verified via git status/diff). Teacher-lacks-dashboard.view asserted via `permissionsFor("teacher")`, not a 403 HTTP round-trip (meta-only check, matches T8 precedent style).
