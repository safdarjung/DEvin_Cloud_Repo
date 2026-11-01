Packet: Batch A — T-016 fix, T-031 phase 2, T-032 phase 2

## 1. T-016 fix (seed attendance window)

Files changed:
- `scripts/seed/sections/attendance.ts` — window start moved from `2026-07-01` to `2026-08-11` so the 60th school day lands on `2026-10-30` (was `2026-09-15`); `SCHOOL_DAYS` is now `export`ed for tests to reuse.
- `tests/db/seed-attendance.test.ts` — AC1 (session/record counts, "every seeded session is submitted") and AC2 (absence rate, "every section has ≥1 absence on the last seeded day") now filter by `date between WINDOW_START and WINDOW_END` (imported from `attendance.ts`) instead of scanning the whole institution / using a dynamic `max(date)`. The determinism test's hardcoded `2026-07-01` is now `WINDOW_START`.

Behavior: with the moved window, all 5 configured holidays (`2026-08-15`, `2026-10-02`, `2026-10-20/21/22`) now fall inside the 60-day span and are genuinely skipped (previously none did — confirmed by computing the raw calendar span before/after the move: all 5 dates sit between `2026-08-11` and `2026-10-30`). Named-student targets (Aarav 92%, Ananya 96%, Ishaan 88% ±1) and the last-day ≥1-absence guarantee are both day-index-relative, so they needed no change and are re-verified by the bounded tests.

Tests run: `pnpm vitest run --project db tests/db/seed-attendance.test.ts tests/db/seed-people-academics.test.ts tests/db/attendance-schema.test.ts` → 29/29 pass (the previously-flaky "attendance.read is scoped" timeout did not reproduce here).

**Found issue — flagging for the lead, not fixed here (would require deviating from the explicit instruction):** today's real date is `2026-10-29` (confirmed via `date -u`), which is now the second-to-last day inside the seeded window (`2026-08-11`..`2026-10-30`). The attendance UI computes "today" from the real Asia/Kolkata wall clock (`src/app/(tenant)/[institution]/attendance/page.tsx`, `src/modules/attendance/actions.ts`'s `todayInTimezone`), so VI-A already has a seeded, submitted session for `2026-10-29`. `e2e/j06-attendance.spec.ts`'s third test ("marking every student and submitting") assumes today has no pre-existing session — that assumption no longer holds while real time is inside the seed window. Result: `pnpm test:e2e e2e/j06-attendance.spec.ts` → 2/3 pass; the third test times out waiting for the "Save" button, which doesn't render because the register already shows "Submitted. Use 'Correct' to change a record." for `VI-A — 2026-10-29` (confirmed via the Playwright error-context snapshot). This is self-resolving: once real wall-clock date passes `2026-10-30`, the collision disappears and all 3 pass again (this was true before the move too — the old window's end, `2026-09-15`, was already in the past relative to every date this project has been worked on, so the collision never showed up before). I did not shift the window to dodge today's date, since the instruction's end date (`2026-10-30`) was explicit and literal, and `attendance.ts`'s seed is deliberately wall-clock-free (no `Date.now()`); introducing a real-time-dependent exclusion would trade a transient test failure for a less predictable seed. Recommend either re-running the e2e spec after `2026-10-30`, or widening the spec to open a date one day beyond the seeded window via `?date=`.

## 2. T-031 phase 2 — `public.enqueue_term_invoices`

Files changed:
- `supabase/migrations/20261028000017_enqueue_term_invoices.sql` (new) — `public.enqueue_term_invoices(p_institution_id uuid, p_term_id uuid, p_grade_id uuid default null)`, single `security definer` function (no `app.*` twin — same shape as `public.jobs_requeue`). Checks `app.current_user_id()` is not null, then `app.has_role(p_institution_id, app.finance_write_roles())` (owner/principal/accountant; admin excluded, matching `generate_invoice`/`record_payment`). Proves `p_term_id` and (if given) `p_grade_id` belong to `p_institution_id` via direct row lookups. Builds the job payload (`{term_id, grade_id}`) entirely from those proven rows and calls `app.enqueue_job(p_institution_id, 'finance.generate_term_invoices', payload, 'invoices:<term_id>:<grade_id|all>')`. Audits `finance.invoice.generate_term.enqueued`. `execute` revoked from `public`/`anon`, granted to `authenticated`.
- `src/modules/finance/schemas.ts` — `GenerateTermInvoicesSchema.gradeId` is optional again (was made required in T-031's fix round 1); omitting it now means "all grades."
- `src/modules/finance/actions.ts` — `generateTermInvoices`'s handler branches: no `gradeId` → calls the new RPC via `supabase.rpc("enqueue_term_invoices", ...)` and returns `{ mode: "enqueued", jobId }`; a specific `gradeId` → unchanged synchronous path via `runGenerateTermInvoices`, now returning `{ mode: "sync", ... }`. New exported type `EnqueueTermInvoicesResult`.
- `src/modules/finance/components/GenerateInvoicesPanel.tsx` — "All grades" option is back in the grade picker (sentinel value, mapped to `gradeId: undefined`); result message branches on `mode`.
- `tests/unit/finance-schemas.test.ts` — updated the "rejects a payload with no gradeId" case to "accepts a payload with no gradeId (all grades, enqueued)".
- `tests/db/enqueue-term-invoices.test.ts` (new) — admin forbidden (accountant succeeds), idempotent (same term+grade → same job id, one row), cross-tenant term and cross-tenant grade both rejected with `not_found`.

Tests run: `pnpm vitest run --project db tests/db/invoice-generation.test.ts tests/db/enqueue-term-invoices.test.ts` → 15/15 pass. `pnpm vitest run --project unit` (full) → 327/327 pass.

Docs: `10-backlog-index.md §3` and `07-security-and-ai-governance.md §4` both updated with this migration's entry.

## 3. T-032 phase 2 — receipt snapshot fields

Files changed:
- `supabase/migrations/20261028000021_receipt_snapshot.sql` (new) — `create or replace app.record_payment`. Diffed against 0008's version: every existing check (amount > 0, idempotent replay fast-path, outstanding-balance validation, received_at not in the future, financial-year math, payment insert/conflict race handling, ledger entries, invoice status transition, audit call) is byte-identical. The only addition: two new lookups (institution/student/term name + admission no; the student's enrolment for the invoice's own academic year, preferring the active row) feeding six new keys into `receipts.snapshot` — `receipt_no`, `school_name`, `student_name`, `admission_no`, `class_label`, `invoice_no`, `term_name` — alongside the existing `amount`/`mode`/`reference`/`received_at`/`heads`. `public.record_payment`'s signature, grants, and role gate are untouched (not re-created).
- `src/modules/finance/queries.ts` — `ReceiptSnapshot` gained the six fields above (string, empty-string fallback for pre-migration receipts missing the keys); `getReceipt` parses them from `snap`.
- `src/modules/finance/components/ReceiptView.tsx` — dropped the `institutionName` prop; school name, student name, admission no, class, invoice no + term name now render from `snapshot` only.
- 3 callers (`finance/receipts/[id]/page.tsx`, `finance/receipts/[id]/print/page.tsx`, `portal/fees/receipts/[id]/page.tsx`) — dropped the `institutionName={ctx.institution.name}` prop.
- `tests/db/payments.test.ts` — new test "snapshot display fields are present and unchanged after the student is renamed": records a payment, reads the receipt, renames the student and the institution, re-reads the receipt, asserts every snapshot field is unchanged.

Tests run: `pnpm vitest run --project db tests/db/payments.test.ts tests/db/invoice-generation.test.ts tests/db/enqueue-term-invoices.test.ts` → 24/24 pass.

Docs: `10-backlog-index.md §3` and `07-security-and-ai-governance.md §4` both updated with this migration's entry.

## 4. Full verification

- `pnpm db:reset` → clean, all 21 migrations applied (0017 and 0021 included), full seed: students 3024, guardians 2515, staff 106, class_sections 72, enrolments 3024, attendance_sessions 4320, attendance_records 181440 — all exact.
- `pnpm db:types` ran as part of `db:reset`; `enqueue_term_invoices` present in generated `src/lib/db/types.ts`. Left unformatted (raw, per CLAUDE.md rule — `oxfmt`/`prettier` binaries aren't installed locally and `npx`/`dlx` is blocked for this batch; additions-only, no hand edits).
- Targeted db tests (T-016 + T-031 + T-032, listed above) → all pass.
- `pnpm test:security` → 465/465 pass.
- `pnpm test:db` (full) → 273/273 pass, 41 files.
- `pnpm test` (unit, full) → 327/327 pass.
- `pnpm lint` → 0 errors (3 pre-existing warnings in `scripts/seed/sections/{admissions,exams,finance}.ts`, not touched by this batch).
- `pnpm typecheck` → clean (one real error found and fixed along the way: `enqueue_term_invoices`'s generated `p_grade_id` arg type is `string | undefined`, not nullable — the "all grades" RPC call now omits the key instead of passing `null`).
- `pnpm demo:reset` → clean, same exact counts as above.
- `pnpm test:e2e e2e/j06-attendance.spec.ts` → 2/3 pass; see the T-016 section above for the one failure (today's real date falling inside the moved seed window) and why it wasn't patched around.

New dependencies: none.

Assumptions made:
- T-016's window start (`2026-08-11`) was derived by walking the existing `schoolDays()` algorithm to find the start date whose 60th school day lands exactly on the instructed end date (`2026-10-30`); not separately specified by the packet.
- T-031's "Wire ... the panel's 'All grades' option to enqueue" was read as: add the option back (removed in T-031's own fix round 1) now that the enqueue path exists, not as building new UI for job status/progress — the panel shows a one-line "Queued" message, no polling.
- T-032's class/section snapshot field uses the student's enrolment for the invoice's own `academic_year_id` (preferring `status = 'active'`, else most recent), not "whatever section the student is in today" — matches the snapshot's immutability intent (receipt reflects the invoice's year, not the viewing date).

## 5. Follow-up — attendance seed window moved to 2026-10-28

Per coordinator instruction, moved the end date one day earlier than the original 2026-10-30 so that today's (10-29) real date — and therefore J-06's live register — stays outside the seeded window. `scripts/seed/sections/attendance.ts`: window start changed from `2026-08-11` to `2026-08-08` (still a fixed calendar date, no wall-clock read), same 60-day count, same holiday set (all 5 still fall inside the span and are skipped), last school day now `2026-10-28`. Named-student targets and the ≥1-absence-on-last-day guarantee are both day-index-relative and needed no change. No other files touched (the bounded tests in `tests/db/seed-attendance.test.ts` already read the window from the export, so they needed no edit for this date shift).

Verified:
- `pnpm db:reset` → clean, all 21 migrations applied, seed counts exact (students 3024, attendance_sessions 4320, attendance_records 181440).
- `pnpm vitest run --project db tests/db/seed-attendance.test.ts tests/db/seed-people-academics.test.ts tests/db/seed-determinism.test.ts` → 21/21 pass.
- `pnpm demo:reset` → clean, same exact counts.
- `pnpm test:e2e e2e/j06-attendance.spec.ts` → 3/3 pass (the previously-failing "marking every student and submitting" test now passes — VI-A's register for today, 2026-10-29, is no longer pre-seeded).

The earlier finding in §1 (today falling inside the window) is resolved by this change; no other verification re-run (lint/typecheck/unit/full test:db/test:security were unaffected by this file and not touched since the previous full-green run in this same session).
