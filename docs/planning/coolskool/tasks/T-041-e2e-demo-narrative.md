# T-041 — E2E demo narrative (13 journeys)

| Field | Value |
|---|---|
| Lane / Day | C / Day 13–14 |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | code-reviewer |
| Feature ids | all P0 rows in `03-feature-matrix.md §3` |
| Depends on | T-028, T-034, T-036, T-039 (merged); J-07 spec from T-034 |
| Migration | — |

## Business outcome
The whole 13-step demo can be replayed automatically from a reset tenant, proving the narrative works end to end and catching regressions before the rehearsal.

## Current repo state (verify before starting)
- Playwright configured: `ls playwright.config.ts e2e/`.
- Demo reset works: `DEMO_RESET_ALLOWED=true pnpm demo:reset` (time it).
- Demo users: `grep -n "demo.coolskool.test" scripts/seed/sections/core.ts`.

## Spec sections to read (only these)
`08-testing-and-acceptance.md §1, §4, §5, §7` · `11-operations.md §3, §10` · `01-executive-brief.md §2` (labels to assert) · `06 §W3–W9` (only the "Feedback"/"User feedback" lines).

## Files to inspect first
`e2e/j07-guardian-portal.spec.ts` and its page objects (T-034) · `playwright.config.ts` (baseURL, webServer) · `src/app/(auth)/login/page.tsx` (demo-account list selectors).

## Expected changes
- `e2e/pages/*.ts` — Page Objects: `LoginPage`, `PublicSitePage`, `AdmissionsPage`, `EnrolmentPage`, `AttendancePage`, `PortalPage`, `AssignmentsPage`, `ExamsPage`, `RecheckPage`, `DashboardPage`, `MessageLogPage`.
- `e2e/fixtures.ts` — `loginAs(role)` fixture, `resetDemo()` global setup (runs `pnpm demo:reset` once per run, guarded by `E2E_RESET=true`).
- `e2e/j00-login-smoke.spec.ts` … `e2e/j13-dashboard.spec.ts` — one spec per journey from `08 §4`, each independent after reset.
- `e2e/demo-narrative.spec.ts` — serial chain J-01→J-13 with `test.describe.configure({ mode: 'serial' })`; records total duration.
- `e2e/a11y.spec.ts` — `@axe-core/playwright` on the five pages in `08 §5`; fails on `serious`/`critical`.
- `e2e/responsive.spec.ts` — 390×844 and 1280×800 screenshots of the same five pages (no horizontal scroll, nav usable).
- `.github/workflows/e2e.yml` — nightly + manual dispatch (not on every push).
- `package.json` — `test:e2e` already exists; add `test:e2e:narrative`.

## Must not modify
Application source except `data-testid` attributes (list every file touched in the report) · seed sections · migrations.

## Permissions / nav / migration numbers needed from the lead
None. New dev dependency `@axe-core/playwright` (justify in report).

## Security and data-integrity requirements
- Specs never use the service-role key; everything goes through the UI with demo logins.
- `E2E_RESET` must be false by default so a stray run cannot reset a non-local target; the global setup refuses when `NEXT_PUBLIC_SUPABASE_URL` is not `127.0.0.1`/`localhost` unless `E2E_ALLOW_REMOTE=true`.

## Acceptance criteria
1. `pnpm test:e2e` passes J-00..J-13 locally from a fresh reset.
2. `demo-narrative.spec.ts` completes in under 10 minutes headless and asserts: enquiry reference shown; admission number format `ADM/2026/nnnnn`; two simulated SMS rows after attendance; AI quiz shows provider badge; report card visible to guardian; corrected result shows "Corrected on"; dashboard tiles non-zero.
3. Draft page text never appears on the public site (J-01 negative assertion).
4. a11y spec reports zero serious/critical violations (or each violation has a filed follow-up in the report).

## Tests (write failing tests first) and exact commands
- `pnpm test:e2e -- e2e/j01-public-site.spec.ts` (start here; grows to all)
- `pnpm test:e2e:narrative`
- `pnpm test:e2e -- e2e/a11y.spec.ts e2e/responsive.spec.ts`

## Deliverables
Page objects, 14 journey specs, narrative spec, a11y/responsive specs, workflow file, list of `data-testid` additions, duration numbers.

## Assumptions and risks
- AI step (J-08) needs Ollama running; the spec skips with a visible `test.skip` reason when `OLLAMA_BASE_URL` is unreachable and the report states it.
- Flakiness from job processing: specs trigger `pnpm jobs:run` via a tiny helper route guarded by `CRON_SECRET` rather than waiting on cron.

## Completion report
Use the format in `CLAUDE.md`.
