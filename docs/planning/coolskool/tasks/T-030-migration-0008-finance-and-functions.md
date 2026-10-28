# T-030 — Migration 0008: finance + immutability + `generate_invoice`, `record_payment`, `enrol_applicant`

| Field | Value |
|---|---|
| Lane / Day | C / Day 5–6 |
| Size | 1.5 agent-days |
| Critical path | yes |
| Review | security-reviewer + lead |
| Feature ids | F-FIN-01, F-FIN-02, F-FIN-03, F-FIN-04, F-FIN-05, F-ADM-03 |
| Depends on | T-026 (merged), T-011 (merged), T-003, T-004, T-005 |
| Migration | `supabase/migrations/20261028000008_finance.sql` |

## Business outcome
Fees, invoices, payments, receipts, and the ledger exist as immutable, tenant-scoped records, and one transactional SQL function turns an accepted application into an enrolled student with a guardian, section, fee assignment, and first invoice.

## Current repo state (verify before starting)
- Migrations 0001–0005 and 0007 merged: `ls supabase/migrations/ | grep -c 2026102800` → 6.
- Helpers exist: `grep -n "function app.next_sequence\|function app.block_mutation\|function app.audit\|function app.enqueue_job" supabase/migrations/*.sql`.
- Admissions tables exist: `grep -n "create table public.applications" supabase/migrations/20261028000007_admissions.sql`.
- Test harness exists: `ls tests/helpers/roles.ts tests/helpers/factories.ts`.

## Spec sections to read (only these)
`05-data-architecture.md §2.6, §5, §6, §7` · `06-workflows-and-contracts.md §W4, §W9` · `07-security-and-ai-governance.md §4` · `08-testing-and-acceptance.md §3 C-20..C-23, C-50..C-54` · `05 §4.1` (`finance`, `numbering` keys).

## Files to inspect first
`supabase/migrations/20261028000001_foundation.sql` (helper signatures) · `20261028000004_people.sql` (students/guardians columns, RLS pattern S+G) · `20261028000007_admissions.sql` (applications columns, status check) · `tests/db/people.test.ts` (fixture style).

## Expected changes
- `supabase/migrations/20261028000008_finance.sql` — tables `fee_structures`, `fee_components`, `fee_assignments`, `concessions`, `invoices`, `invoice_lines`, `payments`, `receipts`, `ledger_entries`; indexes; `app.block_mutation` triggers on `invoice_lines`, `payments`, `receipts`, `ledger_entries`; revision-audit trigger on `payments`; RLS class C (`app.finance_roles()`) plus guardian/student own-scope SELECT on `invoices`, `invoice_lines`, `payments`, `receipts`; functions `app.generate_invoice(student_id uuid, term_id uuid) returns uuid`, `app.record_payment(invoice_id uuid, amount numeric, mode text, reference text, received_at timestamptz, idempotency_key text) returns jsonb`, `app.enrol_applicant(application_id uuid, class_section_id uuid, fee_structure_id uuid, roll_no int) returns jsonb`; `grant execute` only to `authenticated` for the three user-invoked functions, each checking `app.has_role` internally.
- `src/lib/db/types.ts` — regenerated via `pnpm db:types`.
- `tests/db/finance.test.ts`, `tests/db/enrolment.test.ts` — new.
- `tests/security/rls-expectations.ts` — add entries for the nine finance tables (class C, own-scope flags).

## Must not modify
Any merged migration · `src/lib/auth/permissions.ts` · `scripts/seed/**` · `src/modules/admissions/**` · `src/app/**`.

## Permissions / nav / migration numbers needed from the lead
None: all finance permissions exist in `07 §2`; migration number is reserved.

## Security and data-integrity requirements
- All functions `security definer set search_path = ''`, schema-qualified names, `auth.uid()` role check at the top (`finance.payment.record` roles for `record_payment`; `admissions.enrol` roles for `enrol_applicant`).
- `record_payment`: lock invoice `for update`; amount ≤ outstanding else `raise 'code:validation_failed'`; existing `idempotency_key` returns the existing `{payment_id, receipt_id, receipt_no}`; receipt number from `app.next_sequence(inst, 'receipt_no:'||fy)`; ledger Dr `cash` (cash) or `bank` (upi/cheque/neft/card) / Cr `fees_receivable`; invoice `paid_total`, `status`; `app.audit('finance.payment.recorded', …)`.
- `generate_invoice`: idempotent on `(student_id, term_id)`; proration per `06 §W9`; `invoice_no` from `'invoice_no:'||fy`; ledger Dr `fees_receivable` / Cr `fee_income` (+ Dr `concession_expense`); audit `finance.invoice.generated`.
- `enrol_applicant`: steps 1–6 of `06 §W4` in one function body; `code:invalid_state` unless `accepted` (returns existing if `enrolled`); `code:conflict` when section full; calls `app.generate_invoice` for the current term; enqueues `notify.enrolment_welcome` with key `enrol:<application_id>`.
- Money columns `numeric(12,2)`; never float arithmetic.

## Acceptance criteria
1. `pnpm db:reset` applies 0008 cleanly; `pnpm db:types` diff contains only the new tables and functions.
2. UPDATE or DELETE on `payments`, `receipts`, `invoice_lines`, `ledger_entries` raises.
3. Teacher client selects 0 rows from every finance table; accountant sees own-institution rows only; guardian sees only own children's invoices/payments/receipts.
4. `record_payment` twice with the same key → one payment, one receipt, balanced ledger; overpayment rejected.
5. `generate_invoice` twice → one invoice; line sum = subtotal; total = subtotal − concession_total.
6. `enrol_applicant` twice → one student, same admission_no, guardian reused by phone, invoice created, application `enrolled`.

## Tests (write failing tests first) and exact commands
- `tests/db/finance.test.ts`: C-50, C-51, C-52, C-53, C-54 → `pnpm test:db -- tests/db/finance.test.ts`
- `tests/db/enrolment.test.ts`: C-20, C-21, C-22, C-23 → `pnpm test:db -- tests/db/enrolment.test.ts`
- `pnpm test:security -- tests/security/rls.generated.test.ts` (must include the nine new tables).

## Deliverables
Migration file, regenerated types, two DB test files, expectations entries, completion report with `db:reset` wall time.

## Assumptions and risks
- Current term = term containing `now()` in the institution's current academic year; if none, latest term (recorded in report).
- Cheques are treated as received when recorded (no clearing state) — DBT candidate.
- Risk: 0007 column names differ from `05 §2.5`; resolve by reading 0007, never by editing it.

## Completion report
Use the format in `CLAUDE.md`.
