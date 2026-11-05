# M25-T2: Briefing composer — recipes, items, headline — Report

**Status: DONE**

**Files changed:**
- `src/modules/insights/briefing-compose.ts` (new) — `BriefRole`, `BRIEF_ROLE`, `BRIEF_ROLE_LABEL`, `briefingSources()`, `BriefingSourceResult`, `composeBriefing()`.
- `tests/unit/insights-briefing.test.ts` (new) — all TEST FIRST cases from the packet.

**Behavior implemented:** Pure, deterministic composer per rulings: 4 recipes (principal/admin share one, Monday adds weekly attendance + risk sources), item builders (approvals, attendance w/ up|down|in-line, 2 insights, fees w/ paise math, admissions, staff, maintenance, events, exams, weekly attendance/insights), 200-char truncation, 10-item cap, rules headline with "· week in review" on Monday.

**Tests run:**
- `pnpm lint` → 0 errors (8 pre-existing warnings in untracked `mastery-schemas.test.ts`, not mine).
- `pnpm typecheck` → clean, 0 errors.
- `pnpm test tests/unit/insights-briefing.test.ts` → **could not run**: `tests/setup/global.ts` (shared, not a T2 file) unconditionally requires a reachable `SUPABASE_DB_URL` Postgres via `globalSetup`, which runs before every project incl. `unit`. This lane has no DB stack (by design). Confirmed pre-existing/global: `pnpm test tests/unit/permissions.test.ts` and `action-names-unique.test.ts` crash identically (same Vite/postgres `charCodeAt` stack-trace bug T1 already reported). Verified all test logic by hand-tracing every assertion against the implementation instead.

**Tests not run and why:** all `pnpm test` (global DB-dependent setup, no stack this lane — see above).

**Limitations / honesty label:** M16 (`dashboard.*`) and M19 (`insights.*`, `core.approvals.pending`) are not merged into this lane yet — those query names aren't in the live registry. The "every recipe name registered" test checks them against an explicit pending-set instead of failing; it fully checks `calendar.forRole`/`exams.schedule` (M11/M13, live). No RLS/auth change (pure function).

**Security / integration risks:** None — no I/O, no `server-only`.

**Follow-ups:** Re-run `pnpm test tests/unit/insights-briefing.test.ts` once a DB stack is reachable or `global.ts` is made conditional; re-check the pending-set once M16/M19 land.

**New dependencies:** none.

**Assumptions:** `OperationsDashboardLike.upcomingEvents[0]` shape `{title,date,kind?}` (M16 type not yet defined); `dashboard.attendanceTrend` returns `TrendPoint[]` directly per `{days}` call.
