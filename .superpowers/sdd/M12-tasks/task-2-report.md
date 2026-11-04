Packet: M12-T2 DBT-40 root cause + fix — migration 0082
Diagnose (demo tenant, before fix): ledger_entries count = 20674, sum(debit) - sum(credit) = 0.00 (books balanced in SQL). Root cause confirmed: read-path bug (PostgREST max_rows=1000 truncating `sumQuery`/termCollectionSummary's un-ranged select), not a write-path double-entry gap. No fix to generate_invoice/record_payment needed.
Files changed: supabase/migrations/20261028000082_finance_aggregates.sql (new); src/modules/finance/queries.ts (listLedgerEntries, termCollectionSummary only); tests/db/finance-aggregates.test.ts (new); src/lib/db/types.ts (regen, +10 lines, additions only).
Behavior: added public.ledger_totals / public.term_collection_totals (language sql, stable, security invoker, search_path='') summing every matching row in SQL; both functions revoke public/anon, grant authenticated. listLedgerEntries/termCollectionSummary now call these RPCs for totals instead of a capped PostgREST select; signatures/return shapes (LedgerPage, TermCollectionSummary) unchanged; balanced still compared in integer paise.
Tests run (RED before fix, GREEN after):
- pnpm db:reset -> clean apply of 0082 + full seed.
- pnpm test:db tests/db/finance-aggregates.test.ts -> 4/4 pass (RED first: 3/4 failed pre-fix with exactly the capped values, e.g. totalCredit 40000 not 60000, invoiceCount 1000 not 1001 — confirms the bug).
- pnpm test:db tests/db/payments.test.ts -> 10/10 pass.
- pnpm test:security -> 2194/2194 pass, 19/19 files (no grants.test.ts changes needed: its "authenticated may execute exactly the 07 §4 public RPCs" check filters security=definer only; the two new functions are security invoker so they're outside that list — expectations unchanged).
- pnpm lint -> clean.
- pnpm typecheck -> clean.
Tests not run: full pnpm test:db suite (ran only this packet's file + payments.test.ts per BRIEF-COMMON single-owner scope).
Limitations / honesty label: none — no UI/badge surface for this fix.
Security / integration risks: none new. ledger_entries RLS (finance_roles() only) and invoices RLS unchanged; new functions are security invoker so they inherit those policies exactly, verified by the "teacher gets 0/0" test.
Follow-ups: listDefaulters still has an uncapped-but-under-1000-typically select with no .range() — same class of risk if a term exceeds 1,000 outstanding invoices; left unchanged per packet scope (T2 FILES list names only listLedgerEntries/termCollectionSummary). Recorded as a new debt line for 12-decision-log.md §Debt by T14 (docs task): "listDefaulters has no .range(); same max_rows=1000 risk above ~1,000 outstanding invoices in one term."
New dependencies (justification): none.
Assumptions made: account filter in ledger_totals passed as an omitted key (not null) to satisfy the generated optional-arg RPC type (`p_account?: string`, not `string | null`) — functionally identical (SQL default null).
