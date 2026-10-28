# T-032 — Payments, receipts (print), ledger view, guardian fee components

| Field | Value |
|---|---|
| Lane / Day | C / Day 9–10 |
| Size | 1.5 agent-days |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-FIN-04, F-FIN-05, F-FIN-06, F-FIN-07 |
| Depends on | T-031 (merged) |
| Migration | — |

## Business outcome
The accountant records cash/UPI/bank payments against invoices and prints a numbered receipt; the ledger and defaulters list are visible; guardians can see their children's invoices and receipts through reusable components.

## Current repo state (verify before starting)
- `grep -n "function app.record_payment" supabase/migrations/20261028000008_finance.sql`.
- `ls src/modules/finance/actions.ts src/modules/finance/queries.ts`.
- `grep -rn "SimulatedBadge" src/components` (exists if T-038 merged; otherwise skip the receipt SMS badge).

## Spec sections to read (only these)
`06-workflows-and-contracts.md §W9` (Payment, Idempotency, Feedback) · `05-data-architecture.md §2.6` (`payments`, `receipts`, `ledger_entries`) · `08 §3 C-52, C-53, C-54`, `§4 J-07` · `07 §2` (finance rows) · `03-feature-matrix.md` row F-FIN-07.

## Files to inspect first
`src/modules/finance/schemas.ts`, `actions.ts`, `queries.ts` · `src/modules/finance/components/InvoiceDetail.tsx` · `src/app/(tenant)/[institution]/finance/invoices/[id]/page.tsx`.

## Expected changes
- `src/modules/finance/schemas.ts` — `RecordPaymentSchema` (`invoiceId`, `amount`, `mode` ∈ settings `payment_modes`, `reference?`, `receivedAt`, `idempotencyKey` uuid).
- `src/modules/finance/actions.ts` — `recordPayment` → `app.record_payment`; returns `{ paymentId, receiptId, receiptNo }`.
- `src/modules/finance/queries.ts` — `getReceipt`, `listLedgerEntries({ from, to, account })`, `listDefaulters({ termId })`, `listStudentInvoices(studentId)` (RLS does the scoping).
- `src/modules/finance/components/{RecordPaymentDialog,ReceiptView,LedgerTable,DefaultersTable,StudentInvoices}.tsx` — `StudentInvoices` and `ReceiptView` are exported for the portal (T-034) and student profile (T-028).
- `src/app/(tenant)/[institution]/finance/{receipts/[id]/page,receipts/[id]/print/page,ledger/page,defaulters/page}.tsx` — print page uses a minimal layout and `@media print` styles.
- `tests/db/payments.test.ts`, `tests/unit/finance-schemas.test.ts`.

## Must not modify
`supabase/migrations/**` · `src/app/(tenant)/[institution]/portal/**` (T-034 owns) · `src/modules/people/**`.

## Permissions / nav / migration numbers needed from the lead
None beyond T-031's nav entry (sub-links live inside the finance pages).

## Security and data-integrity requirements
- `idempotencyKey` generated client-side once per dialog open (`crypto.randomUUID()`), so a double submit is harmless.
- Receipt view renders from `receipts.snapshot`, never from live joins (the receipt must not change if names change later).
- No UPDATE path for payments anywhere in TypeScript; "cancel" is out of scope (DBT-04 link in UI copy: "Contact admin to reverse").
- Guardian components rely on RLS own-scope; the page still calls `requirePermission('finance.read')`.

## Acceptance criteria
1. Recording ₹5,000 cash on a ₹12,000 invoice sets status `part_paid`; the receipt page shows `RCT/2026-27/000nnn` and the head-wise snapshot; print view has no nav.
2. Clicking "Record" twice quickly yields one payment (same receipt number shown).
3. Attempting ₹8,000 on a ₹7,000 outstanding invoice shows the `validation_failed` message inline.
4. Ledger page totals: Σdebit = Σcredit for the selected range; defaulters list excludes fully paid students.
5. `StudentInvoices` rendered for `guardian.one` shows only that guardian's children.

## Tests (write failing tests first) and exact commands
- `tests/db/payments.test.ts`: C-52 (idempotency, overpayment, immutability, gap-free receipt numbers), C-53 (balanced ledger), C-54 (guardian scope) → `pnpm test:db -- tests/db/payments.test.ts`
- `tests/unit/finance-schemas.test.ts` → `pnpm test -- tests/unit/finance-schemas.test.ts`
- Manual: J-07 fee part after seed (T-033) — record in report.

## Deliverables
Action, queries, five components, four pages, tests, completion report.

## Assumptions and risks
- Print uses browser print; no PDF generation dependency.
- Receipt SMS notification is P1; only add the badge if `<SimulatedBadge />` exists.

## Completion report
Use the format in `CLAUDE.md`.
