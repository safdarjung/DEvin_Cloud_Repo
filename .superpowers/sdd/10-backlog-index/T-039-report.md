# T-039 — Principal dashboard (KPIs + Recharts)

## Files changed

- `src/modules/attendance/queries.ts` — added `todayInInstitutionTimezone` (private helper, mirrors `actions.ts`'s own `todayInTimezone`), `attendanceTodaySummary(ctx)`, `sectionsBelowThreshold(ctx)`.
- `src/modules/finance/queries.ts` — added `termCollectionSummary(ctx, termId)`.
- `src/modules/exams/queries.ts` — added `examGradeDistribution(ctx, examId?)`.
- `src/modules/admissions/queries.ts` — **no change**. Reused the existing `getAdmissionsFunnelCounts(ctx, academicYearId?)`, already exported "for T-039 (dashboard)" by T-027/T-029. Writing a second `admissionsFunnel` wrapper around it would have been a pointless alias.
- `src/modules/core/dashboard.queries.ts` (new) — `getDashboardData(ctx)` composer, plus pure helpers `roundPercent` and `formatINR` (the ones unit-tested).
- `src/modules/core/components/dashboard/{KpiTile,AttendanceChart,CollectionsChart,FunnelChart,GradeDistributionChart,RecentActivity}.tsx` (new).
- `src/app/(tenant)/[institution]/dashboard/page.tsx` — replaced the T-039 placeholder.
- `tests/unit/dashboard-dto.test.ts`, `tests/db/dashboard-queries.test.ts` (new).
- `package.json` / `pnpm-lock.yaml` — added `recharts@3.10.1` (lead ruling 1; React 19-compatible, no peer warnings).

**Not touched**: `src/lib/nav.ts`, the login redirect (`src/app/(auth)/login/actions.ts`), and `src/app/(tenant)/[institution]/page.tsx`. All three already implement lead ruling 5 exactly as specified — `/dashboard` is already `NAV_ITEMS[0]` gated on `dashboard.view`, and the institution root page already redirects to `/dashboard` when the signed-in member has `dashboard.view`, `/portal` otherwise. `tests/unit/nav.test.ts` already encodes this and passes. Nothing to add there.

## Each query, its role gate, and scope

| Query | Permission gate | RLS scope reasoning |
|---|---|---|
| `attendanceTodaySummary(ctx)` | none in the query itself — RLS + the page's `requirePermission(ctx, "dashboard.view")` upstream | Filters `attendance_records` by `attendance_sessions.date = today` (institution-local timezone, not server UTC — see below). Row count is bounded by how many students were marked *today*, not the ~181k-row history. |
| `sectionsBelowThreshold(ctx)` | same | Same today-only filter, grouped by `class_section_id` client-side (unavoidable — Postgrest has no `GROUP BY`; see "SQL view candidates" below). |
| `getAdmissionsFunnelCounts(ctx)` (reused, not renamed) | none in the query — RLS + page gate | Already existed; two `select(status)` queries over `enquiries`/`applications`, both institution-scoped, no date filter (funnel counts are all-time by design). |
| `examGradeDistribution(ctx, examId?)` | none in the query — RLS + page gate | Selects only the `grade` column (never the full result row `listResultsForExam` fetches) for one exam. Defaults to the most recently published exam when no `examId` is given. |
| `termCollectionSummary(ctx, termId)` | none in the query — RLS + page gate | Selects only `total, paid_total` for one term's invoices, reduced to integer paise with the existing `moneyToPaise` (same pattern as `listLedgerEntries`/`listDefaulters`). |
| `getDashboardData(ctx)` (composer) | gates `collections` on `ctx.permissions.has("finance.read")` and `recentActivity` on `ctx.permissions.has("notification.log.read")` | `Promise.all` over all five; finance/activity become `null`, never zeroed, when the permission is absent (CLAUDE.md rule 7 / packet AC3). |

The actual `dashboard.view` gate is `requirePermission(ctx, "dashboard.view")` in `page.tsx`, called **before** `getDashboardData` — a teacher (who lacks it) never reaches any aggregate. Verified in both test files (`requirePermission(...)` throws `AppError` for `teacher`).

## Timing (db test, against the seeded `st-josephs-demo` tenant)

`pnpm vitest run --project db tests/db/dashboard-queries.test.ts` → **8/8 passed**, whole file in 1.13s including DB round trips. The two real `expect(ms).toBeLessThan(1500)` assertions (`attendanceTodaySummary`, `sectionsBelowThreshold` as principal) passed on the current data — both are date-filtered, so they don't hit the unfiltered-scan problem P-01's `20261028000020_rls_performance.sql` fixes (that migration's own comment cites *unfiltered* `count(*)` over `attendance_sessions`/`attendance_records` as the slow case: 7.9s for principal, 15–30s for teacher/guardian/admissions). I did not add a hard timing assertion for `examGradeDistribution`/`termCollectionSummary`/`admissionsFunnel` since the demo tenant currently has no admissions/exam/finance seed data to time meaningfully (see next section) — those assertions would pass trivially on an empty table and tell us nothing.

## Seed-data gap (found, not caused by this packet)

`scripts/seed/sections/admissions.ts`, `exams.ts`, and `finance.ts` are still 5–6 line TODO stubs, not the T-029/T-021/T-033 seed sections the packet's dependency list implies are merged. So on the current seeded tenant:
- `examGradeDistribution` returns `null` (no published exam) — AC1's "grade distribution sums to 3,024" cannot be checked yet.
- `getAdmissionsFunnelCounts` returns all-zero stage/status maps — AC1's funnel-count match cannot be checked yet.
- `termCollectionSummary` has no academic year/term to even call against in some runs — AC1's Term 1 collected/due match cannot be checked yet.

I did not touch those seed files (not named in this packet, and `scripts/seed/index.ts` / `academics.ts` / `attendance.ts` are already modified by other in-flight work I was told not to touch). The db test is written defensively — it skips or soft-asserts where seed data is absent, and asserts the deterministic parts (permission gating, percentage math, invariants like `sum(distribution) === total` and `collected <= due`) regardless of seed state. **This should be re-run once T-021/T-029/T-033 land** to check the actual AC1 numbers (3,024 results; Term 1 collected/due; funnel counts).

Attendance (T-016) *is* seeded (148-line `attendance.ts`, not a stub), which is why `attendanceTodaySummary`/`sectionsBelowThreshold` have real numbers to check today.

## SQL view candidates (not built — P-01 owns migrations)

Two aggregates group by a column Postgrest can't `GROUP BY` server-side, so they currently fetch one narrow column and count in JS:

1. `examGradeDistribution` — `select grade from results where exam_id = $1 and superseded_by is null`, counted per grade in JS. Fine at a few thousand rows per exam; a production-scale institution with far more results per exam should get:
   ```sql
   select grade, count(*) from public.results
   where institution_id = $1 and exam_id = $2 and superseded_by is null
   group by grade;
   ```
2. `sectionsBelowThreshold` — selects today's `(status, class_section_id)` pairs and groups client-side. Bounded to one day's marks (not the 181k-row history), so this is much less urgent, but the exact-scale fix would be a view joining `attendance_records`/`attendance_sessions`/`class_sections` with a `group by class_section_id` and the weighted-present expression baked in.

Neither was added as a migration — flagging per the packet's instruction to request a number from the lead instead.

## Timezone fix found and applied

`attendanceTodaySummary`/`sectionsBelowThreshold` originally used `new Date().toISOString().slice(0, 10)` (server UTC date). `attendance/actions.ts`'s `todayInTimezone` already proved this is wrong for this app — attendance dates are institution-local (`settings.locale.timezone`, default `Asia/Kolkata`, UTC+5:30), so a UTC-date "today" would be off by one day for part of the evening IST. Added a local `todayInInstitutionTimezone(ctx)` to `attendance/queries.ts` (same 3-line `Intl.DateTimeFormat` approach as `actions.ts`'s private helper, duplicated rather than exported across the "use server" boundary) and used it in both new queries.

## Dataviz choices

Used the app's existing `--chart-1`..`--chart-5` CSS tokens (`src/app/globals.css`, already a validated light/dark-safe grayscale ramp — not a placeholder I needed to swap) rather than inventing a new palette. Each chart is a horizontal or vertical `BarChart` (never a line/time-series — every aggregate here is a single point-in-time snapshot, not a series) with:
- `"use client"` only on the four chart components (`KpiTile` and `RecentActivity` stay server components, no client state).
- A `sr-only` text summary of the same numbers next to every `aria-hidden` chart, since Recharts' SVG output isn't independently screen-reader-accessible.
- `CollectionsChart` takes `formatINR` as a prop rather than reimplementing money formatting, so there is exactly one INR formatter (`dashboard.queries.ts`).

## Deviations from the packet text

- `admissionsFunnel(ctx)` — not written as a new function; reused `getAdmissionsFunnelCounts` directly (already exists, already exported "for T-039"). Noted above.
- `examGradeDistribution(ctx, examId)` — made `examId` optional; the composer calls it with no argument and the query resolves "the most recently published exam" itself, since the dashboard has no exam picker.
- Nav/login-redirect items in "Permissions / nav / migration numbers needed from the lead" — already done by prior work; nothing added.

## Tests run

- `pnpm vitest run --project unit tests/unit/dashboard-dto.test.ts` → 7/7 passed.
- `pnpm vitest run --project unit` (full unit project, not just this packet's file) → 327/327 passed, no regressions.
- `pnpm vitest run --project db tests/db/dashboard-queries.test.ts` → 8/8 passed, 1.13s, against the seeded demo tenant (no reset/mutation performed).
- `pnpm typecheck` → clean (one Recharts `Tooltip` `formatter` type error found and fixed in `CollectionsChart.tsx` — `ValueType | undefined` vs `number`).
- `pnpm lint` → 0 errors; 3 pre-existing warnings, all in `scripts/seed/sections/{admissions,exams,finance}.ts` (unused `_ctx` in the TODO stubs) — not mine, not touched.

## Tests not run / not fully verifiable

- `pnpm test:e2e -- e2e/j13-dashboard.spec.ts` — not run; T-041 (the journey) doesn't exist yet, per the packet's own note.
- AC1's exact numbers (3,024 grade-distribution total; Term 1 collected/due; funnel counts) — blocked on the T-021/T-029/T-033 seed gap described above, not on this packet's code.
- Desktop + 390px screenshots — not captured; this session has no browser/dev-server access. The page was verified via `typecheck`/`lint`/unit+db tests only, not visually.

## Concurrency note (not a bug in this packet, but worth flagging)

`src/modules/finance/queries.ts` is a file both this packet and the in-flight T-034 (guardian portal) agent edited concurrently. By the time I checked `git status`, a `T-034 guardian portal` commit (`ce3f99a`) had landed and `git diff HEAD -- src/modules/finance/queries.ts` showed **no diff** — meaning my `termCollectionSummary` addition got swept into that commit's `git add` of the same file, rather than staying uncommitted under my own name. The code itself is correct (verified by `pnpm typecheck`/`pnpm lint`/the db test, all run after that commit), but the lead should know `termCollectionSummary` is sitting inside the T-034 commit, not a T-039 commit, if commit attribution matters for review.

## Honesty labels

`RecentActivity` always renders `<SimulatedBadge />` next to its "Recent activity" heading — it reads `listDeliveryLog` (SMS/email are always `status = 'simulated'`, never a real provider call, per 06 §3). No other tile is simulated or limited.

## New dependencies

`recharts@3.10.1` — lead ruling 1, already in the pinned stack per `CLAUDE.md` but not installed. React 19-compatible, no peer-dependency warnings on install.

## Assumptions made

- "Current term" for `termCollectionSummary` = the most recent academic year (`listAcademicYears` orders `starts_on desc`) + `getCurrentTermId` (reused from `people/queries.ts`, date-overlap logic) — not re-derived, to avoid duplicating that logic.
- "The exam" for the grade-distribution tile = the most recently published exam institution-wide, since the dashboard has no exam picker and the packet doesn't specify one.
- Sections-at-risk threshold = `settings.attendance.alert_thresholds.critical` (defaults to 75, matching AC4's "below 75%" wording), evaluated against *today's* attendance only, consistent with "Scope to today/this term" (lead ruling 3) rather than a rolling term average.
