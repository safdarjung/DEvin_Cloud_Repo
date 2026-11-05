# M16 security review — findings and outcomes

Reviewer is read-only; this file is written by the fix pass, not the review.

## Findings (as handed off)

### MEDIUM — `/login` 500s app-wide; M16's own e2e acceptance never ran
File: `.superpowers/sdd/M16-tasks/task-12-report.md`

M16's own stated acceptance (Controller: run e2e j13/j06/j07 green before commit)
could not be completed: `/login` 500s app-wide in this lane because
`src/modules/exams/actions.ts` exports `throwMappedSchedule` (non-async) from
a `"use server"` file. Confirmed independently by T10, T11, T12 and T14. The
dashboard/today/portal real-widget page swaps (the actual UI deliverable of
M16) therefore ship with no successful end-to-end verification in this lane.
Fix: make `throwMappedSchedule` non-exported or move it out of the
`"use server"` file (owned outside M16's file list), then re-run e2e
j13/j06/j07 before merge.

### HIGH — teacher BOLA gap on the attendance register route
File: `e2e/j06-attendance.spec.ts`

Pre-existing (not introduced by M16, confirmed against unmodified HEAD by
task-11) but currently-failing test "teacher.viii-b cannot open VI-A's
register directly" expects 404 and gets 200 — a teacher can open another
class teacher's attendance register by direct URL. Out of M16's
file-ownership scope to fix here, but it is a live, unresolved BOLA gap on
the attendance register route; flag to that route's owner before relying on
RLS/route guards elsewhere in the dashboard stack.

### LOW — timetable widget always renders when module is disabled
File: `src/app/(tenant)/[institution]/today/page.tsx`

`timetableTodayFor`'s fetch resolves to `[]` (fulfilled) rather than being
skipped when module "timetable" is disabled, so the "Today's timetable"
widget now always renders (empty state) instead of being hidden when the
module is off, unlike the permission-gated widgets on the same page (e.g.
`papersWidget`). Same pattern in `portal/page.tsx` for both `timetable` and
`attendanceTrend`. Cosmetic/consistency issue, not a data leak (RLS/module
still correctly gate the actual data).

### LOW — missing explicit permission-check comment on `portalDashboard`
File: `src/modules/core/dashboard-member.queries.ts`

`portalDashboard`'s `outstandingFees`, `attendance`, `timetable` fields have
no explicit permission check beyond the query's own `student.read` gate
(only `latestResult`/`upcomingAssignments` get an extra module check) —
correct per the ruling and safe in practice only because downstream RLS
(`finance_roles()`, attendance role lists, `timetable_slots` policy)
independently blocks roles like admissions/accountant from seeing data they
shouldn't; verified finance RLS blocks admissions correctly. Document this
reliance-on-RLS explicitly (e.g. a code comment) so a future edit to RLS or
to this composer doesn't silently reintroduce a gap.

## Outcomes

### MEDIUM — `throwMappedSchedule` non-async export — **fixed**
- Moved `throwMapped`/`throwMappedSchedule` out of
  `src/modules/exams/actions.ts` (a `"use server"` file) into
  `src/modules/exams/schedule-conflicts.ts` (no directive, pure helpers,
  already imported by `actions.ts`). `actions.ts` now only exports async
  `defineAction` results.
- Updated `tests/unit/exam-schedule-error-mapping.test.ts`'s import to the
  new location (still 5/5 passing).
- Added `tests/unit/use-server-exports-async.test.ts` — repo-wide static
  guard: no `"use server"` module may have a non-async top-level
  `export function`. Verified red against the old bug shape (reintroducing a
  stray `export function` into a `"use server"` file fails it), green on the
  fixed tree.
- Dropped the now-unused `mapSqlError` import from `actions.ts`.
- Re-ran `pnpm db:reset` (DB owner for this lane) to get a clean seed, then
  `DEMO_AUTO_LOGIN=false PLAYWRIGHT_BASE_URL=http://localhost:3123 pnpm
  test:e2e e2e/j13-dashboard.spec.ts e2e/j06-attendance.spec.ts
  e2e/j07-guardian-portal.spec.ts` → **9/10 pass**; `/login` no longer 500s.
  The 1 remaining failure is the pre-existing HIGH BOLA gap above (expected,
  out of scope).
- While re-running j07, found and fixed a locator strict-mode violation in
  the M16-T12 test itself (`e2e/j07-guardian-portal.spec.ts:149`): the trend
  chart's sr-only `<figcaption>` starts with the same text as the visible
  card title, so the non-exact `getByText("Attendance, last 30 days")`
  resolved to 2 elements once `/login` stopped masking it. Fixed with
  `{ exact: true }`.
- `pnpm exec eslint` + `tsc --noEmit` on all touched files clean; full
  `pnpm lint` and `pnpm typecheck` clean; full `pnpm test` (unit) 1423/1423
  pass; `pnpm test:db tests/db/dashboard-member.test.ts
  tests/db/dashboard-perf.test.ts tests/db/dashboard-leader.test.ts
  tests/db/dashboard-office.test.ts` 28/28 pass.

### HIGH — attendance-register BOLA gap — **skipped, out of scope**
Confirmed still reproducing after the MEDIUM fix and a fresh `db:reset`/reseed
(same 404-expected/200-received failure). `e2e/j06-attendance.spec.ts` is a
shared file across T10/T11/T12/T14 and this packet only re-ran it; the
underlying gap is in the attendance register route/RLS, which is outside
M16's file-ownership scope. Flagging again here, as the finding itself
requires, for the attendance-register route owner.

### LOW — timetable widget renders when module disabled — **fixed**
- `src/app/(tenant)/[institution]/today/page.tsx`: `timetableWidget` is now
  gated on `isModuleEnabled(ctx, "timetable") &&` before `settled(...)`,
  matching the existing `papersWidget`/`assignmentsWidget`/
  `notificationsWidget` permission-gated pattern on the same page.
- `src/app/(tenant)/[institution]/portal/page.tsx`: `timetable` gated on
  `isModuleEnabled(ctx, "timetable")`, `attendanceTrendWidget` gated on
  `isModuleEnabled(ctx, "attendance")`, matching the existing `studyHelper`/
  `insightCards` permission-gated pattern on the same page.
- No new test added: this repo has no render harness for these async RSC
  page components (no `@testing-library/react`/jsdom in the Vitest config;
  the only existing coverage of these pages is e2e, which only asserts the
  widget is *visible* when its module is on, not hidden when off). The two
  already-existing widgets this change now mirrors (`papersWidget`,
  `studyHelper`) are themselves untested for the hidden case. Building a
  module-toggle e2e flow would mean flipping `timetable`/`attendance` off on
  the shared demo tenant mid-suite — `attendance` is in fact a **core**
  module and cannot be disabled (`tests/db/core-modules.test.ts` "a core key
  is rejected with invalid_state") — risking a stuck demo-tenant module state
  if cleanup fails, which would violate rule 11 (demo data is a contract).
  Verified instead by `tsc --noEmit` + `eslint` (clean) and by re-running the
  full e2e trio above, which still shows the widgets rendering correctly when
  modules are on.
- `pnpm typecheck` / `pnpm lint` (full) clean.

### LOW — `portalDashboard` RLS-reliance undocumented — **fixed**
- Added a code comment in `src/modules/core/dashboard-member.queries.ts`
  directly above the `Promise.all` in `portalDashboard`, naming exactly
  which fields (`timetable`, `attendanceTrendPoints`, `attendance`,
  `invoices`) rely on downstream RLS rather than an extra permission check,
  which RLS policies each depends on, and that this needs re-checking if
  those policies or this composer's shape change.
- Comment-only change; `tests/db/dashboard-member.test.ts` re-run (8/8 — see
  combined count above) to confirm no behavior change.
