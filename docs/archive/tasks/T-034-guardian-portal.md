# T-034 — Guardian portal shell composing lane components

| Field | Value |
|---|---|
| Lane / Day | C / Day 11–12 |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | F-STU-02, F-STU-11, F-ATT-05, F-FIN-06, F-EXM-05, F-ACA-05, F-COM-01 |
| Depends on | T-015, T-022, T-032, T-019 (all merged); T-020 for the recheck entry point |
| Migration | — |

## Business outcome
A guardian logs in, switches between their children, and sees attendance, fees with receipts, the report card (with a recheck request button), assignments, and notifications — all scoped by RLS, nothing else.

## Current repo state (verify before starting)
- Components exported by lanes: `grep -rn "export function StudentAttendanceSummary\|export function StudentInvoices\|export function ReceiptView\|export function ReportCard\|export function StudentAssignments" src/modules`.
- Tenant context exposes `membership.guardian_id` / `student_id`: `grep -n "guardian_id\|student_id" src/lib/auth/context.ts`.
- Seeded guardian with two children: `grep -n "guardian.one" scripts/seed/sections/people.ts`.

## Spec sections to read (only these)
`04-architecture.md §4` · `07-security-and-ai-governance.md §2` (stu/grd columns), `§1 T2` · `05-data-architecture.md §2.2` (`guardian_students`) · `08 §4 J-07`, `§3 C-11, C-54` · `09 §4` (portal conflict-zone rule).

## Files to inspect first
`src/app/(tenant)/[institution]/layout.tsx` and `src/lib/nav.ts` (role-based nav) · each exported component's props · `src/modules/notifications/components/Inbox.tsx` (if T-038 merged).

## Expected changes
- `src/modules/people/queries.ts` — `listMyChildren(ctx)` (via `guardian_students` where `portal_access`), `getMyStudent(ctx)` for student role.
- `src/app/(tenant)/[institution]/portal/layout.tsx` — child switcher (`?student=<id>` validated against `listMyChildren`), tabs.
- `src/app/(tenant)/[institution]/portal/page.tsx` — overview tiles (attendance % this term, outstanding fees, latest result, open assignments).
- `src/app/(tenant)/[institution]/portal/{attendance,fees,fees/receipts/[id],results,assignments,notifications}/page.tsx` — thin pages composing lane components.
- `src/modules/people/components/ChildSwitcher.tsx`.
- `tests/db/portal-scope.test.ts`, `e2e/j07-guardian-portal.spec.ts` (page objects shared with T-041).

## Must not modify
Lane components themselves (`src/modules/{attendance,finance,exams,academics}/components/**`) — request prop changes from the owning lane · `src/lib/nav.ts` (request the line).

## Permissions / nav / migration numbers needed from the lead
Nav: `{ href: '/portal', label: 'My children' | 'My school', roles: ['guardian','student'] }`. Permissions exist (`student.read s`, `attendance.read s`, `finance.read s`, `exam.result.read s`, `assignment.read s`).

## Security and data-integrity requirements
- The selected student id is re-validated server-side against `listMyChildren`/`getMyStudent` on every page; an id outside the set → `notFound()`.
- Pages call `requirePermission` for each tab's permission even though RLS scopes rows (two layers).
- No finance or exam write actions are reachable from the portal except `requestRecheck` (T-020).

## Acceptance criteria
1. `guardian.one` sees two children; switching changes every tab's data.
2. Visiting `/portal/results?student=<other guardian's child id>` returns 404.
3. `student.one` sees only themself; no switcher.
4. Receipt view in the portal matches the accountant's receipt page for the same receipt number.
5. All five tabs render without console errors on 390×844.

## Tests (write failing tests first) and exact commands
- `tests/db/portal-scope.test.ts`: C-11 and C-54 through `listMyChildren` + each query used by the tabs → `pnpm test:db -- tests/db/portal-scope.test.ts`
- `e2e/j07-guardian-portal.spec.ts` (J-07) → `pnpm test:e2e -- e2e/j07-guardian-portal.spec.ts`

## Deliverables
Layout, six pages, two queries, switcher component, tests, nav request, screenshot list in report.

## Assumptions and risks
- If T-020 is late, the recheck button is hidden behind a feature check and noted as "pending T-020" (not labeled simulated).
- Component prop mismatches are the main risk; resolve by adapter wrappers inside `portal/`, never by editing lane components.

## Completion report
Use the format in `CLAUDE.md`.
