Packet: X04-T4 Migration 0087 part 2 — apply_late_fees, sweep, voucher lines

Files changed: supabase/migrations/20261028000087_fee_plans.sql (append); tests/db/fee-plans-late-fees-sql.test.ts (new); src/lib/db/types.ts (regen, +121/-0).

Behavior implemented: resumed an interrupted run — migration SQL (public.apply_late_fees, public.enqueue_due_late_fees, public.ledger_voucher_lines) and test file already existed. Verified against rulings, ran db:reset (clean apply + seed) and db:types. Fixed 2 pre-existing test bugs: (1) status assertion wrongly expected 'part_paid' after a single charge — app.add_invoice_charge (X03-owned, untouched) only flips 'paid'->'part_paid', so unpaid 'issued' stays 'issued'; fixed assertion. (2) per_day and ews_rte tests called setupInvoice 3-4x on one institution, each defaulting isCurrent:true -> violated academic_years_one_current_idx; added isCurrent param (default true) to setupInvoice, false on 2nd+ calls (generate_invoice takes termId explicitly, unaffected).

Tests run: pnpm db:reset -> clean; pnpm db:types; pnpm test:db tests/db/fee-plans-late-fees-sql.test.ts tests/db/fee-plans-rls.test.ts -> 24/24 pass; pnpm test:security tests/security/grants.test.ts -> 9/9 pass (apply_late_fees/enqueue_due_late_fees already in serviceOnly list, set_invoice_instalments in PUBLIC_AUTHENTICATED — all from prior T2/T4 work, unchanged by me); pnpm lint -> 0 errors (removed 1 unused-import warning in my file; remaining warnings are in mastery-schemas.test.ts, not touched); pnpm typecheck -> clean.

Tests not run and why: full test:security/test:db suites not run (packet scopes to the two files above; other lanes' concurrent edits to timetable/M25 files untouched).

Limitations / honesty label: none (no UI; T12/Workstream D handles the LimitedBadge).

Security / integration risks: grants.test.ts and rls-expectations.ts were already modified on disk before this session (T2 + earlier interrupted T4 pass) — confirmed entries match rulings, did not re-edit them.

Follow-ups: none new.

New dependencies: none.

Assumptions made: isCurrent=false is safe for 2nd+ academic years sharing an institution in this test file (generate_invoice/add_invoice_charge never read is_current on that path).
