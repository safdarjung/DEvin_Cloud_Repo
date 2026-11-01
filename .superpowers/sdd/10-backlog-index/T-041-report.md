Packet: T-041 E2E demo narrative (13 journeys)

Files changed:
- `e2e/fixtures.ts` (new) — `loginAs(role)`, `DEMO_ROLES`/`SLUG`/`PASSWORD`, `runJobsOnce`, `isOllamaReachable`, `generateQuizWithRetry`, `reportCardBySubjectCount`, and the `globalSetup` default export (demo:reset, guarded by `E2E_RESET=true` + local-only check).
- `e2e/j00-login-smoke.spec.ts` (new) — every demo role logs in; staff-with-dashboard.view lands on /dashboard, teachers land on /attendance, guardians/students on /portal; no console errors.
- `e2e/j08-ai-quiz.spec.ts` (new) — teacher.x-a generates/edits/saves/publishes an AI quiz on the real seeded "Quadratic Equations" unit; guardian.one sees it published. Skips visibly if Ollama is unreachable.
- `e2e/j13-dashboard.spec.ts` (new) — principal dashboard tiles (attendance/collections/funnel/grade distribution) all non-zero; seeds a same-day attendance session itself so it also passes standalone.
- `e2e/demo-narrative.spec.ts` (new) — J-01→J-13 serial chain against the real seeded demo tenant and named entities (APP-live-1/2, Aarav's Term 2 invoice, X-A/Mathematics, Ananya). ~1.3 min.
- `e2e/a11y.spec.ts`, `e2e/responsive.spec.ts` (new) — the 5 named pages (login, dashboard, attendance, guardian portal, public home).
- `.github/workflows/e2e.yml` (new) — nightly (02:00 UTC) + `workflow_dispatch`.
- `package.json` — added `test:e2e:narrative`.
- `playwright.config.ts` — added `globalSetup: "./e2e/fixtures.ts"` (inert unless `E2E_RESET=true`).
- No application source touched beyond the above test infra; no migrations, no seed sections.

Behavior implemented: all 13 journeys now have a spec (new: J-00, J-08, J-13; existing: J-01–J-07, J-09–J-12 untouched); one serial narrative spec proves the whole 13-step demo end to end from the real seed data; a11y/responsive smoke on the 5 named pages; nightly CI workflow.

Tests run:
- `pnpm demo:reset` → ~40–52s, succeeds.
- `pnpm test:e2e` (full suite, `E2E_RESET=true OLLAMA_MODEL=qwen2.5:3b`) **twice back-to-back**: **79 passed, 0 failed, both runs** (5.8m, 5.7m).
- `e2e/demo-narrative.spec.ts` alone: 12/12 passed, 1.3 min (well under the 10-minute budget).
- `pnpm test`: 358 passed (32 files).
- `pnpm lint`: clean.
- `pnpm typecheck`: clean.
- DB/SQL: not touched by this packet — `pnpm test:db`/`pnpm test:security` not re-run (not my file ownership this packet, no SQL changed).

Acceptance criteria (08 §4):
1. `pnpm test:e2e` passes J-00..J-13 locally from a fresh reset — yes (twice).
2. `demo-narrative.spec.ts` < 10 min, asserts: enquiry reference ✓; `ADM/2026/nnnnn` ✓; 2 simulated-SMS attendance message ✓ (message-log row count not separately asserted — the submit-time text already names "2 absences... (SMS simulated)"); AI quiz provider badge ✓; report card visible to guardian ✓; "Corrected on" ✓; dashboard tiles non-zero ✓.
3. Draft text never on public site — J-01 already covers this; the narrative also checks it.
4. a11y: no automated axe-core run (see Follow-ups) — hand-rolled substitute (alt text, accessible names, `<main>` landmark) is green on all 5 pages.

Limitations / honesty label: no UI/doc honesty-label changes needed (none of this packet's changes touch user-facing demo copy).

Security / integration risks: none introduced — every new spec goes through the UI with demo logins or the existing `/api/jobs/run` CRON_SECRET route; no service-role bypass added anywhere in `e2e/**`.

Found (not fixed — see Follow-ups for why):
- **Guardian/student report cards never show the exam name.** `ReportCard`'s title is `{studentName} — {examName}`; `examName` resolves via `exams(name)` embedded in `RESULT_SELECT` (`src/modules/exams/queries.ts`), but `exams_select` RLS (`supabase/migrations/20261028000009_exams.sql`) is `app.staff_roles()` only — guardians/students can never read `exams` directly, so that embed is silently null, on *every* exam, for every guardian/student, always. Invisible with one published exam (today's standalone J-10/J-11/J-12 specs); visible as soon as a student has two (this narrative's new PT2-X alongside the seeded Half-Yearly). Worked around in `demo-narrative.spec.ts` via `reportCardBySubjectCount` (finds the right card by its subject-row count instead of by name). Real fix needs either a new RLS policy or carrying the name in the result snapshot — both are migrations, out of scope for this packet ("Must not modify: ... migrations").
- **Teacher role hits a transient server error on every login.** `/login` with no `?next=` falls back to `/`, which redirects to `/[institution]`, which redirects to `/portal` for anyone without `dashboard.view` — `teacher` is neither dashboard-permitted nor guardian/student-shaped, so it lands on `PortalOverviewPage` and throws "You do not have permission to perform this action." (logged server-side, visible as `[browser] Uncaught Error` in dev). Harmless in every spec here (each immediately navigates to an explicit URL after login, same as the rest of the suite), and never hit by the real demo script (teachers always land on a specific page), but it is a real one-line-reachable 500 for a role that just bookmarks the site root. Not fixed: the right fix (route staff without `dashboard.view` somewhere other than `/portal`) is a judgment call beyond this packet's "prove the 13 journeys" scope, and I didn't want to touch shared root-redirect logic on a hunch under this packet's time budget.

Follow-ups (12-decision-log.md §Debt):
- Swap `e2e/a11y.spec.ts`'s hand-rolled checks for `@axe-core/playwright` once a new-dependency run is approved (this run was told "no new deps"; `axe-core` itself is only a transitive dependency, not hoisted/importable without adding the direct devDependency).
- Fix the guardian/student report-card exam-name gap above (RLS or snapshot change — needs a migration).
- Consider fixing the teacher-login transient redirect above (root-redirect logic, not this packet's file).
- `.github/workflows/e2e.yml` lets `playwright.config.ts`'s own `webServer` start the app (`pnpm dev`, since `CI` is always set in Actions, `reuseExistingServer` is never true there) rather than `pnpm build && pnpm start` as sketched in `08-testing-and-acceptance.md §10` — a deliberate simplification to avoid a port-3000 collision between a manually pre-started server and Playwright's own; `pnpm build` still runs as its own CI step so a broken production build still fails fast.

New dependencies (justification): none. (`@axe-core/playwright` was in the packet's own "Permissions" note but this run was explicitly told "No new deps" — see Follow-ups.)

Assumptions made:
- J-05 in the narrative enrols only Riya Verma (APP-live-1), not also Kabir Mehta/APP-live-2 (already `accepted` and used for J-04's decision-trail check) — the acceptance criteria don't require both, and skipping the second enrolment keeps the narrative under its time budget.
- J-09/J-10 in the narrative fills all 42 X-A marks directly (skips the "one missing, then clean" verification dance) — that exact mechanic is already proven in the standalone `e2e/j09-marks-entry.spec.ts`, which this packet didn't touch.
- `OLLAMA_MODEL=qwen2.5:3b` and 5 questions (schema minimum, not the UI's default 10) — the 3B model intermittently returns invalid quiz JSON at 10 questions; `generateQuizWithRetry` (3 attempts, visible `test.skip` if all fail) absorbs this known limitation (08 §8) without weakening the assertion on a real pass.
- `test:e2e:narrative` is `playwright test e2e/demo-narrative.spec.ts` (packet didn't specify the exact command).
