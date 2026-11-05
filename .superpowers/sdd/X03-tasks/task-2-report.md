Packet: X03-T2 Migration 0086 part 1 — tables, RLS, guard, issue/renew, module_catalog insert

Files changed:
- `supabase/migrations/20261028000086_library.sql` (new)
- `tests/db/library-rls.test.ts` (new, 17 tests)
- `tests/security/rls-expectations.ts` (3 rows: library_books, library_copies, library_loans)
- `tests/security/grants.test.ts` (added public.issue_library_loan, public.renew_library_loan to 07 §4 list)
- `src/lib/modules/catalog.ts` (MODULE_KEYS was missing 'library' — T1 added it only to OPTIONAL_MODULE_KEYS; fixed, else module-enabled-sql.test.ts drift stays red)
- `src/lib/db/types.ts` (regen, raw)

Behavior implemented: library_books/library_copies/library_loans tables + RLS (07 §2.2); app.guard_library_catalog (institution_id/book_id immutable, no withdraw while on loan); app.issue_library_loan/public.issue_library_loan + app.renew_library_loan/public.renew_library_loan (definer core + thin wrapper, caller check owner/principal/admin→proceed, member-other-role→forbidden, non-member→not_found); app.module_catalog insert for `library` (default off).

Tests run:
- `pnpm db:reset && pnpm db:types` → clean, seed 77s
- `pnpm test:db tests/db/library-rls.test.ts` → 17 passed
- `pnpm test:db tests/db/module-enabled-sql.test.ts` → 8 passed
- `pnpm test:security` → 2317 passed (19 files) — rls-expectations + grants expectations updated
- `pnpm test tests/unit/modules-catalog.test.ts tests/unit/library-config.test.ts tests/unit/permissions.test.ts` → 68 passed
- `pnpm lint && pnpm typecheck` → clean

Tests not run and why: T3 tests (return/fine) — part 2 not written yet.

Limitations / honesty label: none; backend only, no UI this milestone.

Security / integration risks: none new; RPC caller check never leaks cross-institution row existence (not_found vs forbidden split per lesson). Advisory lock keyed `library_borrower:<id>` per rulings.

Follow-ups: T3 appends app.add_invoice_charge + return_library_loan to same migration file.

New dependencies: none.

Assumptions made: backdating test fixtures keep due_on >= issued_on (shifted both dates) since that's a DB check constraint; 4 db tests needed explicit `it(..., ms)` timeouts (15–30s) under full-scale seeded-DB auth load, same pattern as DBT-46.
