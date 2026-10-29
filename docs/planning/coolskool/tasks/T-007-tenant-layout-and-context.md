# T-007 — Tenant layout, `getTenantContext`, nav shell, institution picker

| Field | Value |
|---|---|
| Lane / Day | B / Day 3 |
| Size | 1 agent-day |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-IDN-03, F-IDN-04 |
| Depends on | T-004, T-006, T-008 (merged) |
| Migration | — |

## Business outcome
Every authenticated page runs inside a verified institution context with a role-aware navigation shell; non-members get a 404 and never learn the institution exists.

## Current repo state (verify before starting)
- `memberships` table exists: `grep -c 'memberships' src/lib/db/types.ts` > 0.
- `requirePermission` and `ROLE_PERMISSIONS` exist: `ls src/lib/auth/`.
- Login works: `ls src/app/\(auth\)/login/page.tsx`.

## Spec sections to read (only these)
- `04-architecture.md §4` (tenant resolution steps 1–4, `cache()`), `§2` (page thinness rule).
- `07-security-and-ai-governance.md §1` T1, T4; `§2` (which roles see which nav areas).
- `09-twenty-day-plan.md §4` (nav conflict zone: `src/lib/nav.ts` data-driven).
- `12-decision-log.md` D5, D6.

## Files to inspect first
- `src/lib/auth/permissions.ts`, `src/lib/auth/require.ts`, `src/lib/supabase/server.ts`, `src/app/page.tsx`.

## Expected changes
- `src/lib/auth/context.ts` — `getTenantContext(slug)`: `getClaims()` → redirect `/login`; query `memberships` ⋈ `institutions` by slug, `status='active'`; none → `notFound()`; returns `TenantContext` (`04 §4`); wrapped in React `cache()`.
- `src/lib/nav.ts` — `NAV_ITEMS: { href, label, icon, permission }[]` for all demo areas (dashboard, students, admissions, attendance, academics/assignments, exams, finance, website, ai, notifications, jobs, settings, portal); filtered by `ctx.permissions`.
- `src/app/(tenant)/[institution]/layout.tsx` — calls `getTenantContext`, renders shell (sidebar from `nav.ts`, header with institution name, role badge, `is_demo` banner "Demo tenant — synthetic data", logout).
- `src/app/(tenant)/[institution]/page.tsx` — redirects to `/dashboard` (or `/portal` for guardian/student).
- `src/app/(tenant)/[institution]/dashboard/page.tsx` — placeholder "Dashboard" with `requirePermission('dashboard.view')` (T-039 fills it).
- `src/app/page.tsx` — institution picker: lists active memberships; one membership → redirect; zero → "No institution assigned".
- `src/components/tenant/*` — sidebar, header, role badge, demo banner.

- `src/components/honesty.tsx` — `<SimulatedBadge />` and `<LimitedBadge />` (shared honesty labels, `10 §5`).

## Must not modify
- `src/lib/auth/permissions.ts` (lead-owned); `supabase/**`.

## Permissions / nav / migration numbers needed from the lead
- All demo permissions already exist in `07 §2`; nav entries for later lanes are declared now as data (lanes only add pages).

## Security and data-integrity requirements
- Slug taken from the route is never trusted beyond the membership query; `institution_id` comes from the membership row.
- Non-member → `notFound()` (not 403) per `04 §4` step 3.
- Context recomputed in every server action by `defineAction`; the layout's context is for rendering only.
- `is_platform_admin` grants no tenant access by itself.

## Acceptance criteria
1. Member of A at `/<slugA>/dashboard` sees the shell with nav filtered by role (teacher: no Finance link; guardian: Portal only).
2. Member of A at `/<slugB>/dashboard` gets 404; unauthenticated gets redirect to login (via proxy).
3. User with two memberships sees the picker at `/`; one membership redirects straight in.
4. `getTenantContext` is called once per request for the same slug (assert via a counting spy in a unit test on the cached wrapper).
5. Demo banner shows only for `is_demo = true`.

## Tests (write failing tests first) and exact commands
- `tests/unit/nav.test.ts` — nav filtering per role equals expected link sets for all nine roles.
- `tests/db/tenant-context.test.ts` — criteria 2–3 using `tests/helpers/roles.ts` (`callAs`), asserting `notFound`/redirect behaviour via the context function directly.
- `e2e/tenant-shell.spec.ts` — J-00 subset: shell renders for principal and guardian.
- Commands: `pnpm test -- tests/unit/nav.test.ts`, `pnpm test:db -- tests/db/tenant-context.test.ts`, `pnpm test:e2e -- e2e/tenant-shell.spec.ts`.

## Deliverables
- Context helper, nav data, layout + shell components, picker, placeholder dashboard, tests, completion report.

## Assumptions and risks
- Next 16 `params` is a Promise — `await params` in layout/pages.
- Icons from lucide; keep the shell minimal (shadcn `Sheet` for mobile nav) — responsive smoke happens on Day 14.

## Completion report
Use the format in `CLAUDE.md`.
