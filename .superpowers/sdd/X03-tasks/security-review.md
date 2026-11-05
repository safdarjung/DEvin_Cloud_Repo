# X03 Library — security review findings

Reviewer is read-only; this file is written by the fixer before any fix lands, then outcomes are appended.

## MEDIUM

1. `docs/planning/coolskool/12-decision-log.md`: T10 inserted two new debt rows reusing IDs `DBT-50` and `DBT-51` (lines ~401-402), which already exist further down the same file (lines 403-404, pre-existing M08/M09 debts about substitutions and resubmission history). Highest existing ID in the file is DBT-80, so the new library rows should be DBT-81/DBT-82.
   Fix: renumber the two new library rows to the next free IDs so the debt register has unique, unambiguous references.

## LOW

2. `src/modules/library/queries.ts`: `libraryOverdue`'s `fineSoFar` is returned in integer paise (`Math.round(daysOverdue * finePerDay * 100)`) while the sibling `libraryMyLoans`'s `fine` field is returned in rupees/decimal (`fine_amount` / `daysOverdue * finePerDay`). Both individually match their own task ruling, but the mixed units between two adjacent read endpoints of the same module is a latent 100x-display-bug risk for any future UI consumer.
   Fix: document the unit mismatch prominently (already partly commented) or align units before the Workstream D UI consumes both.

3. `src/lib/actions/result.ts`: `mapSqlError` has a generic branch for SQLSTATE 42501→forbidden and 23505→conflict but none for 23503 (FK violation), even though the X03 packet's own error-mapping ruling states `23503 → not_found` and 'never internal for these'. Today this is unreachable in library code because every borrower/invoice/copy existence check is done explicitly before any write that could trip an FK constraint, but it's a latent gap versus the stated contract — any future caller that hits a raw 23503 (e.g. a race deleting a referenced row) gets `internal` instead of `not_found`.
   Fix: add a generic 23503→not_found branch to `mapSqlError` (benefits every module, not just library).

---

## Outcomes

1. MEDIUM (decision-log DBT-50/51 collision) — **fixed**. Renumbered the two library debt rows at `docs/planning/coolskool/12-decision-log.md` lines 401-402 from `DBT-50`/`DBT-51` to `DBT-81`/`DBT-82` (next free IDs after the existing max `DBT-80`). No other file referenced the old library-row IDs (`10-backlog-index.md` and the X03 task reports don't cite the numbers), so no further edits needed.

2. LOW (queries.ts unit mismatch) — **fixed** (documentation, per ruling — not a unit change). `X03-tasks.md` rulings ruling explicitly mandate `fineSoFar` (library.overdue) in integer paise and `fine_amount`/invoice-line money in rupees/decimal numeric(12,2), so aligning units would contradict the spec. Instead made the mismatch impossible to miss: added an explicit "UNIT WARNING" paragraph to `libraryOverdue`'s doc comment, a unit note on the `LibraryLoanRow.fine` field, and a one-line unit note on `libraryMyLoans`'s doc comment, each cross-referencing the other. `src/modules/library/queries.ts`. No behavioral change; `tests/db/library-queries.test.ts` reran green (6/6).

3. LOW (mapSqlError missing 23503) — **fixed**. Added `if (sqlState === "23503") return fail("not_found", "A related record was not found.");` to `mapSqlError` in `src/lib/actions/result.ts`, matching the X03 ruling and already-shipped per-module 23503 handling in `calendar/actions.ts` and `transport/actions.ts` (which intercept 23503 before falling through to `mapSqlError` and are unaffected by this change — verified by reading both). Added a failing-first unit test `tests/unit/define-action.test.ts` ("maps SQLSTATE 23503 (FK violation) to not_found") asserting the mapped code and that the raw constraint name is not leaked in the message. Full `pnpm test` (1624/1624), `pnpm test:security` (2386/2386), `pnpm lint`, `pnpm typecheck` all clean after the change.

