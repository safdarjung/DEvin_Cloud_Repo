Packet: Batch C — zero-net invoice fix, 2 pre-existing UI bugs, tenant-shell portal root-cause, e2e stability

## 1. Zero-net invoice (100% concession) ledger crash

Migration (new): `supabase/migrations/20261028000024_zero_net_invoice.sql` — `create or replace function app.generate_invoice` (same `(uuid, uuid) returns uuid` signature as 0008, so no new 07 §4 definer row). Root cause (`superpowers:systematic-debugging`, confirmed with a failing test before any fix): `ledger_entries` has `check ((debit = 0) <> (credit = 0))` — exactly one side must be nonzero. When concessions cover 100% of every fee head, net total is 0, and the old code always inserted a `fees_receivable` row with `debit = total = 0, credit = 0` — a degenerate (0,0) row the constraint rejects. This is exactly why `scripts/seed/sections/finance.ts` shipped with a 99%-not-100% ews_rte shortcut (0008's own header comment references it).

Fix: skip the `fees_receivable` insert entirely when `v_total = 0` (nothing receivable — `fee_income`/`concession_expense` still balance each other). Also sets `status = 'paid'` on insert when `v_total <= 0` (mirrors `app.record_payment`'s own `paid_total >= total` rule, with `paid_total` still at its 0 default). Every other check/branch is byte-identical to 0008.

TDD: `tests/db/finance.test.ts` — new case **C-51c** ("a 100% concession on every head produces a net-zero invoice, no ledger check-constraint violation, status paid"), written first against unmodified 0008 (RED — same `(debit=0)<>(credit=0)` violation the seed shortcut was dodging), green after the migration. Also ran `tests/db/invoice-generation.test.ts`/`enqueue-term-invoices.test.ts`/`seed-finance.test.ts` (31/31) to confirm no regression to the 99%-style partial-concession path.

`scripts/seed/sections/finance.ts`: ews_rte concession back to a literal 100% (`percent: 100`), shortcut comment removed, reason text updated ("full" not "near-full").

**Follow-up bug found during full `pnpm db:reset`** (not asked for, but blocking): `generateAndPay`'s payment plan computed `amount = total` (full) or `total/2` (half) without checking `total > 0` first — for a now-100%-waived (total=0) student, that called `app.record_payment(amount: 0, ...)`, which rejects `amount <= 0` ("amount must be greater than zero"), failing the whole seed. Fixed with an early `if (total <= 0) return;` right after fetching the invoice (nothing to pay — `generate_invoice` already marked it `paid`). `pnpm db:reset` and `DEMO_RESET_ALLOWED=true pnpm demo:reset` both run clean after this (payments count dropped 4233→4120, exactly the waived-student invoices that no longer get a spurious $0 payment).

`pnpm db:types`: no diff — `generate_invoice`'s signature is unchanged and no columns/tables changed.

## 2. `dashboard/page.tsx` passing `formatINR` into a Client Component

`src/modules/core/components/dashboard/CollectionsChart.tsx` is `"use client"` and received `formatINR` (from `dashboard.queries.ts`, which has `import "server-only"`) as a prop — a function can't cross the Server→Client boundary, and that module can't even be imported from client code. Fix: `CollectionsChart` now has its own one-line local `formatINR` (duplicated, not extracted to a shared module — this component owns its own display formatting) and no longer takes a `formatINR` prop. `src/app/(tenant)/[institution]/dashboard/page.tsx`'s call site drops the prop. `dashboard.queries.ts`'s own `formatINR` export is untouched (still used server-side for the KPI tile text, which has no client-boundary issue).

## 3. `VerificationPanel.tsx:68` `router.refresh()` during render

Was called unconditionally in the component body on every render ("Cannot update a component (Router) while rendering a different component"). Moved into a `useEffect([openState, closeState, reopenState, router])` — fires once per actual status-transition result, not every render.

## 4. `tenant-shell.spec.ts` "guardian sees Portal" — root-caused, not worked around

Reproduced with Playwright (not guessed): the guardian fixture had a membership but **no linked child at all** (`guardian_students` row). `resolvePortalSelection` (T-034) correctly `404`s a guardian with zero children (`selected = children[0]` is `undefined` → `notFound()`) — this predates Batch B's redirect-on-absent-`?student=` change, so the suspected redirect wasn't actually the cause; the fixture never gave the portal anything to select. Separately, and independently, the test asserted a literal `heading("Portal")` that has **never existed** anywhere in the app — `e2e/j07-guardian-portal.spec.ts` (T-034's own suite) already asserts the real convention, `heading("My school")`/`"My children"` (`PortalNav`'s actual text); the sidebar's `/portal` nav item is a **link** named "Portal", not a heading.

Both are spec bugs, not app bugs (CLAUDE.md: "fix the app, not the spec, unless the spec is wrong" — confirmed wrong here against `j07`'s established contract). Fix: `test.beforeAll` now inserts a real `students` row + `guardian_students` link (mirrors how a guardian account is always created in practice — alongside an enrolment) and cleans it up in `afterAll`; the heading assertion is now `"My children"`; the `"Attendance"` link assertion is scoped to `getByRole("navigation", {name: "Portal tabs"})` (the unscoped locator was a strict-mode violation — guardians also hold `attendance.read` for their own child, so the sidebar has its own "Attendance" link). Ran 3× serially, all green.

## 5. e2e stability

- `playwright.config.ts`: `workers: 1` (was default/`fullyParallel` with no cap). Several specs build/write heavy DB fixtures concurrently and collide under default parallelism; 1 worker trades speed for determinism, matching what the seed packet's own lead already found (`SEEDS-report.md`: j09/j10/j11/j12/tenant-shell "all passed" under `--workers=1`).
- `e2e/j10-publish-results.spec.ts`:
  - Unique fixture labels: `suffix` now mixes `Date.now()` with a random base36 component (plain `Date.now()` can collide across workers starting in the same millisecond) — fixes the exam-paper checkbox aria-label collision. **Found a second, independent cause of the same symptom**: the fixture's subject was literally named `"Science"`, which collides in `PaperGrid`'s checkbox aria-label (`${section.label} ${subject.name}`, no code/id) with the seeded demo tenant's own `"Science"` subject (`scripts/seed/lib/subjects.ts`) — deterministic, not a concurrency artifact. Subject renamed to `` `Science ${suffix}` ``.
  - Unique guardian phone: was a hardcoded `"9800000700"`, which collides with `guardians(institution_id, phone)`'s unique constraint on any rerun against the persistent demo tenant without an intervening `demo:reset`. Now derived per-run.
  - `afterAll` cleanup added: a direct Postgres connection (same shape as `tenant-shell.spec.ts`) deletes the fixture's results/marks/exam_papers/exams (under `app.allow_reset`, required because `app.marks_guard`/`results_guard` only allow DELETE with that GUC set — unreachable from the PostgREST admin client this spec otherwise uses), enrolments, guardian_students, memberships, students, guardians, subjects, class_sections, grades, and the guardian's auth user.
  - **Root cause of a third, much deeper symptom** (not asked for, found via `superpowers:systematic-debugging` after the above two fixes still left the Save button on the marks-entry page completely inert — no network request, no console/page error, no DOM change, confirmed with a Playwright trace and ruled out: soft-vs-hard navigation, session/relogin, role, student count, dirty count, string encoding, Turbopack staleness, and the describe/afterAll wrapper, each via an isolated minimal repro before moving to the next hypothesis): the fixture filled `"92"` into a student's marks input, but `max_marks` defaults to 80 — `92 > 80` trips the `<input type="number" max={80}>`'s native HTML5 constraint validation, which silently blocks the native form submission (and therefore React's `useActionState` submit handler) *before* a `submit` event is ever dispatched. This was wrong in the original file (confirmed via `git show HEAD`, predates this packet) — it was simply never reached before, because the checkbox-collision bug above always failed first. Fixed by filling `"70"` instead.
  - j10 now passes 3× in a row, standalone and inside the full suite, both serially and under the capped config.
- `e2e/j06-attendance.spec.ts` (found during the required two full `test:e2e` runs, not in the brief, but blocking the 38/38-twice gate): the test submits a real `attendance_sessions` row for VI-A/today in the shared demo tenant; a second run on the same calendar day finds that session already `submitted` (no "Save"/"Submit" controls render), so the test times out after 30s. Fixed with a cleanup step before the test: delete any existing `attendance_records`/`attendance_sessions` row for VI-A on "today" (no `app.allow_reset` needed — only `attendance_corrections`, not these two tables, is `block_mutation`-guarded). **Bug in my own first fix, caught before landing**: computed "today" with `new Date().toISOString().slice(0,10)` (UTC), but the app computes it in the institution's timezone (`Asia/Kolkata`, UTC+5:30) — for roughly 5.5 hours a day the two disagree on the calendar date, so the cleanup query matched nothing while the real submitted row sat untouched. Fixed with `toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })`. Verified 2× back-to-back.
- `tests/db/seed-admissions.test.ts` (found during the required full `test:db` run, not in the brief): both T-029 "named demo entity" assertions (`APP-live-1`/`APP-live-2`) selected the fixture row by `applicant->>'firstName' = 'Riya'`/`'Kabir'` with no `ORDER BY`/uniqueness guarantee — both names are also in `scripts/seed/lib/names.ts`'s generic random-name pools, so a randomly generated enquiry/application can coincidentally share the same first name and the query (no `LIMIT`/order, destructured `[row]`) can pick that one instead. Fixed by filtering on each fixture's known-unique guardian phone (`9800000101`/`9800000002` + `lastName = 'Mehta'` for the reused-guardian case) instead, keeping the name as a secondary assertion.

## Tests run

- `pnpm db:reset` — clean (confirms the finance seed fix).
- `DEMO_RESET_ALLOWED=true pnpm demo:reset` — clean, twice.
- `vitest run --project db` → **309/309** (45/45 files).
- `vitest run --project security` → **474/474**.
- `vitest run --project unit` → **358/358**.
- `pnpm lint` → clean.
- `pnpm typecheck` → clean.
- `pnpm test:e2e` (full suite, `workers: 1` from this packet's config change) → **38/38**, run twice back-to-back with no reset in between → **38/38** both times.

## Limitations / honesty label

No UI/AI honesty labels touched. No new dependencies.

## Security / integration risks

None introduced. `app.generate_invoice`'s only behavior change is skipping a ledger row that was never valid to write (the DB would have rejected it) and marking a genuinely-$0 invoice `paid` instead of `issued` — both strictly more correct than before. No RLS/permission changes. `app.allow_reset` usage in the new `j10` `afterAll` follows the existing `tenant-shell.spec.ts` precedent exactly (service_role/`session_user='postgres'`-equivalent, test-teardown-only).

## Follow-ups (new debt for `12-decision-log.md` §Debt)

- `e2e/j06-attendance.spec.ts`'s "not idempotent across same-day reruns" class of bug may recur in other specs that submit real state into the shared demo tenant (attendance, finance, exams) keyed by a real calendar/business date rather than a fixture-owned one — worth a systematic audit if more flakes of this shape show up.
- `PaperGrid.tsx`'s checkbox `aria-label` is `${section.label} ${subject.name}` with no code/id disambiguator — any two subjects sharing a display name (not just "Science") will collide the same way for any future fixture/UI flow. Not fixed here (not in this packet's file list); flagging for the exams module owner.

## New dependencies

None.

## Assumptions made

- Task 1's "Add 07 §4 definer row if signatures change": `app.generate_invoice`'s signature is unchanged (`create or replace`, same `(uuid, uuid) returns uuid`), so no 07 §4 edit was made, per the task's own conditional.
- Treated `e2e/j06-attendance.spec.ts` and `tests/db/seed-admissions.test.ts` as in-scope "e2e stability" / verification-blocking fixes even though neither was named in the brief, since the brief's own verification gate (`test:db` green, `test:e2e` 38/38 twice) cannot be met without them and both are the same class of bug (shared, non-fixture-scoped state colliding across runs) as the named j10/tenant-shell fixes.
