Packet: M12-T4 Migration 0074 — reversals, void_payment, fee_reminders, enqueue, collection report

Files changed: supabase/migrations/20261028000074_finance_plus.sql (new); tests/db/finance-plus-rls.test.ts (new); src/lib/db/types.ts (regen, additions only); tests/security/rls-expectations.ts (+2 entries: payment_reversals, fee_reminders); tests/security/grants.test.ts (+3 entries: app.finance_void_roles, public.enqueue_fee_reminders, public.void_payment — required for the C-03-style grants audit to stay green, not in original FILES list but a shared registry edit).

Behavior implemented: payment_reversals + app.void_payment/public.void_payment (void/refund/cheque_bounce, idempotent, Dr fees_receivable/Cr cash|bank reversal, invoice issued/part_paid); fee_reminders table; public.enqueue_fee_reminders (one job/term/day); notification_preferences category check +'finance'; public.finance_collection_report (term/grade/mode grouping, security invoker).

Deviation (recorded): public.void_payment checks app.is_member() before app.has_role() — unlike 0008's single-check wrapper — so a same-institution role mismatch is forbidden while a cross-institution payment id is not_found, per ruling. Documented in the migration file.

Tests run: pnpm db:reset (clean, 0074 applied, seed ok) → pnpm db:types (additions only, verified via git diff) → pnpm test:db tests/db/finance-plus-rls.test.ts → 11/11 pass → pnpm test:db tests/db/finance.test.ts → 10/10 pass (no regression) → pnpm test:security → 2212/2212 pass (19 files) → pnpm lint clean → pnpm typecheck clean.

Tests not run and why: tests/db/online-payments*, fee-reminders job handler, finance-collection-report query-layer, finance-void action tests — all belong to T5/T7/T8/T9 (not yet landed).

Limitations / honesty label: none (no UI/badge surface in this packet).

Security / integration risks: finance_collection_report is security invoker with no in-function role check (same pattern as 0082's ledger_totals) — a direct RPC call by a non-finance role returns 0 rows, not an error; relies entirely on invoices/payments/fee_assignments RLS. listDefaulters' 1000-row cap (T2's known debt) is unrelated/untouched.

Follow-ups: none new; T7 must prove payment ownership before calling void_payment (ruling already requires this); T9 wires finance.collectionReport to this RPC.

New dependencies (justification): none.

Assumptions made: grants.test.ts counted as a shared-registry file requiring an edit (brief's "shared registries... Edit/append only" covers it); constraint name notification_preferences_category_check confirmed against the live DB before dropping it.
