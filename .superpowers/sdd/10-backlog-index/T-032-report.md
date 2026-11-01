Packet: T-032 Payments, receipts (print), ledger view, guardian fee components

Files changed:
- src/modules/finance/schemas.ts — `RecordPaymentSchema`
- src/modules/finance/actions.ts — `recordPayment`, `requireInvoice`
- src/modules/finance/queries.ts — `getReceipt`, `listLedgerEntries`, `listDefaulters`, `paymentModesFor`
- src/modules/finance/components/{RecordPaymentDialog,ReceiptView,LedgerTable,DefaultersTable,StudentInvoices}.tsx (new)
- src/app/(tenant)/[institution]/finance/invoices/[id]/page.tsx (wired `RecordPaymentDialog`)
- src/app/(tenant)/[institution]/finance/{receipts/[id]/page,receipts/[id]/print/page,ledger/page,defaulters/page}.tsx (new)
- tests/unit/finance-schemas.test.ts (added `RecordPaymentSchema` cases), tests/db/payments.test.ts (new)

Behavior implemented:
`recordPayment` validates an invoice belongs to `ctx.institution` (BOLA guard — `public.record_payment` only checks the caller's role against the invoice's *own* institution, not the route's), validates `mode` against the institution's own `settings.finance.payment_modes` (not just the DB's 5-value check constraint), then calls `public.record_payment` and returns `{paymentId, receiptId, receiptNo}`. No second audit (SQL function audits). `getReceipt` renders only from `receipts.snapshot`. `listLedgerEntries` is paginated (capped at 100/page) and date-range validated; totals are summed separately over the full range so the page's displayed Σdebit/Σcredit isn't just the current page. `listDefaulters` filters to issued/part_paid invoices for a term. Ledger/defaulters pages are gated with `finance.structure.manage` (= exactly owner/principal/admin/accountant, matching `app.finance_roles()`) rather than the broader guardian/student-inclusive `finance.read`. Receipt print page hides the tenant header/sidebar via a scoped `@media print` rule (couldn't restructure the Next.js layout tree without touching the shared tenant `layout.tsx`, which is out of scope).

Action permission and scope proofs (file:line):
- `src/modules/finance/actions.ts`: `recordPayment` registered with `permission: "finance.payment.record"` (defineAction call, ~line 438). `src/lib/auth/permissions.ts` ROLE_PERMISSIONS: admin's list does NOT include `finance.payment.record` (confirmed by test below); accountant/owner/principal do.
- `requireInvoice` (actions.ts, added helper) does `.eq("id", id).eq("institution_id", institutionId)` before any RPC call — proves tenant scope independent of the SQL function.
- Ledger/defaulters pages: `requirePermission(ctx, "finance.structure.manage")`, not `finance.read` — see comments in `ledger/page.tsx` / `defaulters/page.tsx` explaining the role-set match to `app.finance_roles()`.
- Receipt pages: `requirePermission(ctx, "finance.read")`, matching the packet's explicit instruction (guardian/student hold `finance.read` scoped "s"; RLS on `receipts` does the actual own-child scoping).

Idempotency and overpay tests (tests/db/payments.test.ts):
- "accountant can record a payment; admin is forbidden" — forbidden envelope for admin, success envelope for accountant.
- "replaying the same idempotencyKey through the action returns the same receipt and does not create a second payment" — asserts one `payments` row.
- "an invoice id from another institution is not_found" (via `withTwoInstitutions`) — proves the BOLA guard.
- "a mode not in the institution's own settings.finance.payment_modes is rejected" — `card` passes the DB check constraint but fails the settings check.
- "recording more than the outstanding balance is rejected with validation_failed".
These are new TS-action-layer tests; the SQL-layer idempotency/overpay/immutability/gap-free-receipt-number/guardian-RLS assertions (C-52/C-53/C-54) already exist in `tests/db/finance.test.ts` (T-030) against the raw `record_payment`/`generate_invoice` RPCs — not duplicated here.

Receipt-snapshot evidence: `getReceipt` test asserts `receipt.snapshot.{amount,mode,reference,invoiceId,heads}` match what was recorded, and that a receipt id real in one institution returns `null` (not another tenant's data) when read under a different institution's context.

Guardian access behaviour: not re-tested at the SQL/RLS level here (already covered by `tests/db/finance.test.ts`'s C-54). `StudentInvoices` relies on that same RLS — calling it for a studentId that isn't the guardian's child returns an empty list, not an error, because `invoices_select`'s RLS predicate just returns no rows.

Deviations:
1. `listStudentInvoices(studentId)` — reused the existing `listInvoicesForStudent(ctx, studentId)` (added by T-028) instead of adding a duplicate query function.
2. `StudentProfile.tsx` (T-028) was **not** switched to `StudentInvoices` — its existing invoice block has its own header/badge copy/layout; swapping is not the "trivial one-line import change" the packet authorized, so left untouched per packet rule 5.
3. `RecordPaymentSchema.amount` uses this module's existing `money`-style `z.number().positive().multipleOf(0.01)` (JS number, 2dp) rather than a decimal string or integer-paise, for consistency with every other money field already in `schemas.ts` (`FeeComponentInputSchema.amount`, `ConcessionInputSchema.amount`).
4. Receipt print page hides nav via a page-scoped `@media print { header, nav[aria-label="Primary"] { display:none } }` `<style>` tag rather than a restructured layout — the shared tenant `layout.tsx` is outside this packet's file list and Next.js layouts can't be unwrapped by a child route.

Honesty label: `RecordPaymentDialog` shows `<LimitedBadge />` with "Payments are recorded manually (cash/UPI/bank reference)" per packet rule 6.

Security/integration risks: none identified beyond the BOLA guard already closed by `requireInvoice`. `ReceiptView` deliberately shows no student/invoice name (snapshot has ids only) to honor "must not change if names change later" — this is a minor UX gap (no name on the receipt), not a security issue; flagged as a possible follow-up if product wants a name on the printed receipt (would need a deliberate decision about whether that breaks the immutability guarantee).

Tests run:
- `pnpm vitest run --project unit tests/unit/finance-schemas.test.ts` → 10 passed
- `pnpm vitest run --project db tests/db/payments.test.ts tests/db/invoice-generation.test.ts` → 20 passed
- `pnpm test` (full unit project) → 313 passed, 29 files
- `pnpm lint` → 0 errors (3 pre-existing warnings in `scripts/seed/sections/*` — not my files)
- `pnpm tsc --noEmit` (whole project) → clean

Tests not run and why: `pnpm test:db` (full) and `pnpm test:security` were not run — packet/lead instruction restricts me to the two named db test files only, since T-016 owns the DB and runs `db:reset` concurrently. E2E (`pnpm test:e2e`) not run — no dev server started, out of scope for this packet's verify list.

Follow-ups: none required for this packet; optional debt item if product later wants the receipt to show a name (see security/integration risks above).

New dependencies: none.

Assumptions made: ledger/defaulters filter forms use plain native HTML GET forms (no new client component) for date-range/term/account filtering, consistent with KISS/YAGNI and the existing codebase's mix of client-state filters (InvoiceTable) and server-driven filters. Ledger date-range defaults to first-of-month through today when no query params are given.

## Fix round 1 (code review, MEDIUM — money float)

Issue: `listLedgerEntries` summed `Number(r.debit)`/`Number(r.credit)` as JS floats, then `LedgerTable.tsx` compared the totals with `===`; a genuinely balanced ledger could show "No". `listDefaulters`'s `outstanding = Number(total) - Number(paid_total)` had the same category of risk.

Fix: added `moneyToPaise`/`paiseToMoney` (`src/modules/finance/queries.ts`) — exact decimal-string-to-integer-paise parsing (string split + digit concatenation, never a float multiply), and the reverse for display. `listLedgerEntries` now sums in integer paise and returns a `balanced: boolean` computed from the integer comparison (not from the display floats); `LedgerTable.tsx` reads `ledger.balanced` instead of re-deriving it. `listDefaulters`'s `outstanding` is now `paiseToMoney(moneyToPaise(total) - moneyToPaise(paidTotal))`.

`StudentInvoices` totals: checked — that component renders each invoice's `total`/`paidTotal` individually (`toFixed(2)`), with no cross-invoice sum or subtraction, so there was nothing to fix there; noting this explicitly since it was named in the review.

New test: `tests/unit/finance-money.test.ts` — `moneyToPaise`/`paiseToMoney` round-trip, and sums of `999.99`/`0.10`/`0.20` in three different orders (forward/reversed/shuffled) all equal `100029` paise / `1000.29`; a dedicated case reproduces the classic `0.1 + 0.2` float-drift input and asserts the paise sum is exactly `30` (`0.30`).

Also updated `tests/db/payments.test.ts`'s ledger-balance assertion to check `ledger.balanced` in addition to `totalDebit === totalCredit`.

Verified: `pnpm vitest run --project unit tests/unit/finance-schemas.test.ts tests/unit/finance-money.test.ts` → 17 passed. `pnpm test` → 320 passed (30 files). `pnpm lint` → 0 errors (3 pre-existing unrelated warnings). `pnpm tsc --noEmit` → clean. `pnpm vitest run --project db tests/db/payments.test.ts` (only this packet's own db file, per instruction — DB owned by another agent) → 9 passed. No `db:reset`/`demo:reset`/`seed`/`db:types`/full `test:db` run. No state-changing git. No new dependencies.
