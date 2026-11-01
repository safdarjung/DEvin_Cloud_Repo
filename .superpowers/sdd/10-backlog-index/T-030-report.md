Packet: T-030 Migration 0008: finance + immutability + `generate_invoice`, `record_payment`, `enrol_applicant`

## Files changed
- `supabase/migrations/20261028000008_finance.sql` (new)
- `src/lib/db/types.ts` (regenerated, additions-only: 297 insertions, 0 deletions)
- `tests/db/finance.test.ts` (new)
- `tests/db/enrolment.test.ts` (new)
- `tests/helpers/factories.ts` (added `createApplication`, `createFeeStructure`, `createFeeComponent`, `createFeeAssignment`)
- `tests/security/rls-expectations.ts` (added 9 finance table entries)
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4 (one row edited, as permitted — documented the `public.*` wrappers)

## Behavior implemented
9 finance tables (`fee_structures`, `fee_components`, `fee_assignments`, `concessions`, `invoices`, `invoice_lines`, `payments`, `receipts`, `ledger_entries`) with RLS class C, `app.block_mutation` on the four immutable tables, and three security-definer functions: `app.generate_invoice` (idempotent per student+term, 06 §W9 proration), `app.record_payment` (idempotent by key, overpayment-rejecting, FY-local receipt numbering), `app.enrol_applicant` (06 §W4 steps 1-6: lock application, guardian-by-phone reuse, capacity-checked enrolment, fee assignment, first invoice, audit, `notify.enrolment_welcome` job).

## Design deviation (recorded per lesson #4's "record deviations")
Role/permission checks live in the `public.*` wrapper (`public.generate_invoice` 571, `public.record_payment` 750, `public.enrol_applicant` 969), not inside the `app.*` function. Reason: `app.enrol_applicant` calls `app.generate_invoice` directly in the same transaction (06 §W4 step 5) — `SECURITY DEFINER` changes execution privilege, not `auth.uid()`, so an admissions-role caller's JWT is still the caller inside that nested call. If `app.generate_invoice` re-checked `app.finance_roles()` from `current_user_id()`, that internal call would wrongly raise `forbidden` for an admissions-only user legitimately enrolling a student. Putting the check in the wrapper means the real exposure surface (a direct PostgREST RPC call — `app` is never PostgREST-exposed, 05 §5) is checked, while the internal `app.*`-to-`app.*` call is trusted, matching `app.assign_application_no` trusting `app.next_sequence` with no re-check (0007 precedent). Tenant-safety is still enforced in every `app.*` function by deriving `institution_id` only from the row named (student/invoice/application/term), never from a separate caller-supplied id — this is the actual "never trust a cross-tenant id" protection, independent of role-checking.

## Table × operation vs 07 §2.2 matrix
| Table | SELECT (class C) | INSERT/UPDATE |
|---|---|---|
| fee_structures/fee_components/fee_assignments/concessions | `app.finance_roles()` = owner/principal/admin/accountant (matches all `finance.*` matrix rows exactly) | same roles, direct writes, FK-same-institution `with check` |
| invoices/invoice_lines/payments/receipts | finance_roles() + guardian/student own-scope (05 §5's stated list) | none — `app.generate_invoice`/`app.record_payment` only |
| ledger_entries | finance_roles() only (not in 05 §5's guardian list) | none — functions only |

## Ledger balance evidence
`tests/db/finance.test.ts` "C-52/C-53" asserts `sum(debit) = sum(credit)` per invoice after a payment, over both the invoice-generation entries (`fees_receivable` + `concession_expense` Dr = `fee_income` Cr) and the payment entries (`cash`/`bank` Dr = `fees_receivable` Cr). Passed.

## Idempotency / race tests
- `generate_invoice` called twice → same invoice id, one row (`finance.test.ts` C-51, C-51b).
- `record_payment` called twice with the same `idempotency_key` → same `receipt_no`, one payment row, one receipt row (C-52/C-53). Race is closed with `insert ... on conflict (institution_id, idempotency_key) do nothing` — the loser re-reads the winner's row instead of erroring (migration lines ~695-705).
- `enrol_applicant` called twice on the same application → same `student_id`/`admission_no`, `already_enrolled: true` second time, one `students` row (`enrolment.test.ts` C-20).

## Guardian-reuse test
`enrolment.test.ts` C-21: two applications with the same guardian phone → one `guardians` row, two `guardian_students` link rows (one per student), both `is_primary = true` (each is its own student's only primary — the `guardian_students_one_primary_idx` partial unique index is per-`student_id`, not per-guardian).

## Context7 / docs-lookup
Not invoked. No Postgres/Supabase API question arose that the existing migration precedent (0001 helpers, 0003 `app.audit`/`app.enqueue_job`, 0005 `enrolment_status_changed`, 0007 `app.submit_public_enquiry`/`public.*` wrapper shape, 0011's SECURITY DEFINER nested-call lesson, 0012's `public.jobs_claim` wrapper shape, 0014's local-timezone-date fix) didn't already settle unambiguously — numeric/date/jsonb/plpgsql behavior used here (numeric arithmetic, `date + int`, `on conflict ... do nothing returning`, `for update` row locks) is standard, unambiguous Postgres, confirmed by the test run rather than docs.

## Tests run
1. `pnpm db:reset` — clean apply, ~35s wall time (first run; rerun after the bug fix below was similar).
2. `pnpm vitest run --project db tests/db/finance.test.ts tests/db/enrolment.test.ts` → **11/11 passed** (second run, after fixing a real bug — see below).
3. `pnpm test:security` → **402/402 passed**.
4. `pnpm test:db` (full) → **141/150 passed in 24 files; 9 failures all in `tests/db/public-enquiry-route.test.ts`**, pre-existing and unrelated: `ReferenceError: phoneIN is not defined` in `src/modules/website/schemas.ts:34` — a T-024 file this packet's instructions say to leave alone. Not caused by this packet; both of this packet's own test files passed in this run.
5. `pnpm test` (unit) → **209/209 passed**.
6. `pnpm lint && pnpm typecheck` → clean for every file this packet touched. The only remaining `typecheck` error is the same pre-existing `phoneIN` reference in `src/modules/website/schemas.ts` (T-024, not touched). `lint` shows only 4 pre-existing `_ctx unused` warnings in other packets' seed stubs.

## Bug found and fixed during TDD
First `pnpm db:reset` + test run surfaced a real ordering bug in `app.generate_invoice`: `invoice_lines` were inserted (referencing a not-yet-persisted `invoices.id`) before the `invoices` row itself was inserted, violating the FK and failing every test that touches invoicing (both files, 7/11 tests). Fixed by inserting the `invoices` row first with placeholder zero totals, then the `invoice_lines` loop, then an `update public.invoices set subtotal=…` after the loop with the accumulated totals — before the ledger entries are written (migration lines ~487-538). Re-ran; all 11 db tests passed.

## Limitations / honesty label
No UI; this packet is DB-only, as scoped. No honesty-label concern (no simulated/limited feature here).

## Security / integration risks
- Concessions with a null `head` (whole-invoice concession) are not applied — shortcut, documented inline in the migration (`app.generate_invoice` comment block) and no demo fixture needs it (05 §8.1 lists none).
- `enrol_applicant`'s roll-number collision (explicit `p_roll_no` already taken) surfaces as a raw Postgres unique-violation, not a named `code:*` error — not in this packet's acceptance criteria; follow-up if the UI needs a friendlier message.
- `due_on` is computed as `term.starts_on + settings.finance.default_due_day` — not specified exactly in the packet; recorded as an assumption below.

## Follow-ups / debt
- `scripts/seed/sections/finance.ts` is still a no-op stub (0ms in the seed log) — out of this packet's scope (owned by a seed packet), but `invoices 6,048 · payments ≈4,234` from `05 §8.1`/`§8.2` and `INV-T2-Aarav` won't exist until that packet calls `app.generate_invoice`/`app.record_payment`.
- A whole-invoice (null-head) concession path, if ever needed by a future demo scenario — new debt entry candidate for `12-decision-log.md` §Debt.

## New dependencies
None.

## Assumptions made
- "Current term" for `enrol_applicant` (06 §W4): the term containing today's institution-local date in the institution's current academic year; if none matches, the latest term by `sequence` (packet's own stated assumption, implemented as written).
- `invoices.due_on = term.starts_on + settings.finance.default_due_day` days — not specified exactly by the packet; a reasonable, simple reading of `05 §4.1`'s `default_due_day` key.
- `payments.idempotency_key` is unique per `(institution_id, idempotency_key)`, not globally unique — per the lead's explicit lesson instruction, overriding `05 §2.6`'s literal `unique(idempotency_key)` wording.
- `financial_year` for the `invoice_no:<fy>`/`receipt_no:<fy>` sequence *keys* is computed from the institution-local date (`settings.locale.timezone`), matching 0014's local-date fix precedent — even though `app.next_sequence`'s own `{FY}` pattern substitution (0001, not editable) still uses the DB session's UTC `current_date` internally. This is an existing inconsistency in 0001, not introduced here; flagging it rather than silently working around it in a way that would mask the behavior.

## Fix round 1

Security review found 1 CRITICAL, 1 HIGH. Both fixed in place in 0008 (unmerged, per rule).

**CRITICAL — admin could write money.** `public.generate_invoice`/`public.record_payment` gated on `app.finance_roles()` (owner/principal/admin/accountant), but 07 §2.2's `finance.invoice.generate`/`finance.payment.record` rows are owner/principal/accountant only — admin excluded. Added `app.finance_write_roles()` (new function, same style/grants as `app.finance_roles()`, returns `['owner','principal','accountant']`) and switched both wrappers to it. `app.finance_roles()` is untouched and still used for RLS reads/structure writes (correctly includes admin there). Checked `enrol_applicant`'s role set (`admissions.enrol` = own/principal/admin/admissions) against the matrix — already correct, no change needed.

**HIGH (DBT-20) — direct `applications.status='enrolled'` bypassed `enrol_applicant`.** `applications_update` (0007, merged, not edited) allows any column update, so an admissions-role caller could set `status='enrolled'` directly with no student/invoice/audit created, stranding the application. Added `app.guard_application_enrolled()` — a `BEFORE UPDATE` trigger on `public.applications` (security definer, `search_path=''`) that raises `code:invalid_state` on any write moving `status` to `enrolled` unless `app.allow_enrol` is set for the transaction. `app.enrol_applicant` now calls `perform set_config('app.allow_enrol', 'on', true)` immediately before its own status update — same `set_config`/`current_setting` shape as 0010's `app.allow_publish`. An INSERT (e.g. a future seed fixture inserting an already-`enrolled` application) is never gated — trigger is BEFORE UPDATE only. Other transition guards (e.g. `accepted` needs a prior decision row) are left to T-027, not addressed here.

Both fixes documented in `07-security-and-ai-governance.md` §4 (the one row this packet may edit).

New tests: `finance.test.ts` "Fix round 1 (CRITICAL)" — admin forbidden on both RPCs, accountant succeeds, `service_role` succeeds (idempotent, same invoice). `enrolment.test.ts` "Fix round 1 (HIGH, DBT-20)" — direct UPDATE to `enrolled` errors and leaves `status='accepted'` with no student row; `enrol_applicant` on the same application still succeeds and reaches `enrolled`.

### Fix round 1 — verification (actual output)
1. `pnpm db:reset` — clean apply.
2. `pnpm db:types` — additions-only (297 insertions, 0 deletions).
3. `pnpm vitest run --project db tests/db/finance.test.ts tests/db/enrolment.test.ts` → **13/13 passed**.
4. `pnpm test:security` → **402/402 passed**.
5. `pnpm test:db` (full) → **163/163 passed, 25 files** (T-025's enquiry-route fix landed; the earlier unrelated `phoneIN` failures are gone).
6. `pnpm test` (unit) → **227/227 passed**.
7. `pnpm lint` → clean (4 pre-existing warnings in other packets' seed stubs, unrelated). `tsc --noEmit` → clean.
