Packet: X03-T3 Migration 0086 part 2 — app.add_invoice_charge + return (Sonnet, DB owner)

Files changed:
- `supabase/migrations/20261028000086_library.sql` (appended part 2)
- `tests/db/library-return-fine.test.ts` (new, 12 tests)
- `tests/security/grants.test.ts` (added `public.return_library_loan` to 07 §4 list)
- `src/lib/db/types.ts` (regen, raw)

Behavior implemented: `app.add_invoice_charge` (finance-owned, no public wrapper, revoked from everyone incl. service_role — lock/validate/insert line/bump subtotal+total/status paid→part_paid/ledger Dr fees_receivable Cr fee_income/audit `finance.invoice.charge_added`); `app.return_library_loan`/`public.return_library_loan` (caller check; days_late calendar days; fine = days_late × fine_per_day for students, 0 for staff; fine>0 & not waived → current-term invoice (latest term starts_on ≤ today) or `invalid_state` if none, nothing written; charges via add_invoice_charge; sets returned_on/returned_by/fine_amount/fine_waived/fine_invoice_line_id; audit `library.loan.returned`).

Tests run:
- `pnpm db:reset && pnpm db:types` → clean, seed 78s
- `pnpm test:db tests/db/library-return-fine.test.ts` → 12 passed
- `pnpm test:db tests/db/library-rls.test.ts` → 17 passed
- `pnpm test:security` → 2317 passed (19 files) — grants list updated
- `pnpm lint && pnpm typecheck` → clean

Tests not run and why: `pnpm test:db tests/db/payments.test.ts` — 2 of 10 tests timed out (5000ms) on `withTwoInstitutions`/multi-signup paths twice in a row, both unrelated to this packet's files (DBT-46 auth-under-load pattern); confirmed `library-return-fine.test.ts`'s own two-institution test is stable with an explicit 15s timeout. `test:security`'s `escalation.test.ts` C-80 (web, unrelated file) timed out once, passed clean on immediate retry.

Limitations / honesty label: none; backend only, no UI this milestone.

Security / integration risks: none new; `add_invoice_charge` unreachable from PostgREST (no public.* wrapper, confirmed by test) and from `authenticated` on its `app.*` core; same row-lock discipline as `record_payment`/`void_payment`.

Follow-ups: T5/T6 (actions) and T9 (HTTP acceptance) build on this; X04 (0087) may reuse `app.add_invoice_charge` per rulings.

New dependencies: none.

Assumptions made: ledger-balance assertion checks institution-wide Σdebit=Σcredit (not scoped to one invoice, since `record_payment`'s own entries also touch `fees_receivable`); "current-term invoice" = latest term with `starts_on ≤ today` joined on `invoices.term_id`, per rulings.
