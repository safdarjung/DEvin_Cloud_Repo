Packet: X04-T2 Migration 0087 part 1 — tables, RLS, principal, plans, status, module_catalog insert

Files changed: supabase/migrations/20261028000087_fee_plans.sql (new); tests/db/fee-plans-rls.test.ts (new); src/lib/db/types.ts (regen); tests/security/rls-expectations.ts (+3 entries); tests/security/grants.test.ts (+1 to PUBLIC_AUTHENTICATED)

Behavior implemented: late_fee_rules/invoice_instalments/late_fee_charges tables + RLS (07 §2.2); app.invoice_principal; public.set_invoice_instalments (membership->role->state->lock->validation, audit); public.invoice_instalment_status (derived paid/overdue/part_paid/due); app.module_catalog 'fee_plans' row + app.module_enabled re-created to add fee_plans->finance_plus to its hardcoded requires case (0084 explicitly anticipates this; the ruling's "never redefined" line is reconciled in a migration-header comment).

Tests run: pnpm db:reset (clean); pnpm db:types; pnpm test:db tests/db/fee-plans-rls.test.ts -> 15/15 pass; tests/db/module-enabled-sql.test.ts tests/db/finance.test.ts -> 18/18 pass; pnpm test:security -> 2422/2425 pass (3 fails are pre-existing 5000ms-timeout flakiness in membership-status.test.ts/website-schema.test.ts/public-enquiry-route.test.ts under full-suite load, unrelated to this packet — all 3 pass in isolation); pnpm lint -> 0 errors; pnpm typecheck -> clean.

Tests not run and why: none skipped.

Limitations / honesty label: none for T2 (no UI).

Security / integration risks: grants.test.ts expectations changed (added public.set_invoice_instalments) — verified via full test:security run above. No other shared file touched.

Follow-ups: T4 appends apply_late_fees/enqueue_due_late_fees + voucher lines to this same migration file.

New dependencies: none.

Assumptions made: app.module_enabled must be CREATE OR REPLACE'd (not left alone) to make fee_plans' finance_plus dependency real — 0084's own header instructs this upgrade path for any future requires key; documented in the migration file.
