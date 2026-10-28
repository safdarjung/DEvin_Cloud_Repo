# T-039 — Principal dashboard (KPIs + Recharts)

| Field | Value |
|---|---|
| Lane / Day | D / Day 12–13 |
| Size | 1.5 agent-days |
| Critical path | no (T-041 depends on it) |
| Review | code-reviewer |
| Feature ids | F-INT-01, F-ATT-05, F-FIN-07, F-ADM-06 |
| Depends on | T-015, T-019, T-027, T-032 (merged); seeds T-016, T-021, T-029, T-033 for real numbers |
| Migration | — |

## Business outcome
The principal opens one page and sees today's attendance, fee collection against dues, the admissions funnel, exam performance, and what just happened — the closing scene of the demo.

## Current repo state (verify before starting)
- Module queries: `grep -n "export async function" src/modules/{attendance,finance,admissions,exams}/queries.ts`.
- Recharts installed: `grep -n '"recharts"' package.json` (add if missing, justify).
- Seed assertions to cross-check: `grep -n "assert" scripts/seed/sections/*.ts`.

## Spec sections to read (only these)
`03-feature-matrix.md` rows F-INT-01, F-ATT-05, F-FIN-07, F-ADM-06 · `08 §4 J-13` · `07 §2` (`dashboard.view`; finance numbers need `finance.read`) · `04 §2` (reads only via owners' `queries.ts`) · `05 §4.1` (`attendance.alert_thresholds`).

## Files to inspect first
`src/modules/attendance/queries.ts`, `src/modules/finance/queries.ts`, `src/modules/admissions/queries.ts`, `src/modules/exams/queries.ts` (extend with aggregate functions only if missing; coordinate with owners) · `src/components/ui/card.tsx`.

## Expected changes
- Aggregate queries (added to the owning module's `queries.ts` under a `// dashboard` section, one function each): `attendanceTodaySummary(ctx)`, `termCollectionSummary(ctx, termId)`, `admissionsFunnel(ctx)`, `examGradeDistribution(ctx, examId)`, `sectionsBelowThreshold(ctx)`.
- `src/modules/core/dashboard.queries.ts` — composes the above with `Promise.all`; returns one typed DTO.
- `src/modules/core/components/dashboard/{KpiTile,AttendanceChart,CollectionsChart,FunnelChart,GradeDistributionChart,RecentActivity}.tsx` — Recharts in client components; server page passes data.
- `src/app/(tenant)/[institution]/dashboard/page.tsx` — `requirePermission('dashboard.view')`; finance tiles only when `finance.read`.
- `tests/db/dashboard-queries.test.ts`, `tests/unit/dashboard-dto.test.ts`.

## Must not modify
Lane component files · migrations · `src/lib/nav.ts` (request `/dashboard` as the default landing for staff roles).

## Permissions / nav / migration numbers needed from the lead
Nav: `{ href: '/dashboard', label: 'Dashboard', permission: 'dashboard.view' }` as first item; landing redirect after login for staff.

## Security and data-integrity requirements
- Aggregates run under the user's RLS; no service role; numbers for a teacher (who lacks `dashboard.view`) are never computed.
- Finance figures hidden entirely (not zeroed) without `finance.read`.
- Charts use the dataviz guidance if the `dataviz` skill is available; otherwise shadcn colors with accessible contrast and labelled axes.

## Acceptance criteria
1. On the seeded tenant: attendance today % equals the seed's last-day figure; Term 1 collected/ due matches `tests/db/seed-finance.test.ts` totals; funnel counts match T-029's assertions; grade distribution sums to 3,024.
2. Page renders in < 1.5 s locally after warm-up (recorded, not asserted).
3. `accountant` sees finance tiles; `exam_controller` does not.
4. Sections below 75% attendance are listed with links.

## Tests (write failing tests first) and exact commands
- `tests/db/dashboard-queries.test.ts` (each aggregate on a small fixture institution; RLS as principal vs teacher) → `pnpm test:db -- tests/db/dashboard-queries.test.ts`
- `tests/unit/dashboard-dto.test.ts` (percent/rounding helpers) → `pnpm test -- tests/unit/dashboard-dto.test.ts`
- `pnpm test:e2e -- e2e/j13-dashboard.spec.ts` once T-041 exists.

## Deliverables
Five aggregate queries, DTO composer, six components, page, tests, screenshot (desktop + 390 px) in report.

## Assumptions and risks
- If an aggregate needs a SQL view for speed, request a fix migration number from the lead rather than computing in TypeScript over 180k rows.
- Fallback ladder item 5 replaces charts with tiles; keep tiles independent of Recharts.

## Completion report
Use the format in `CLAUDE.md`.
