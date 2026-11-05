Packet: X03-T9 Acceptance over HTTP

Files changed:
- `tests/db/library-acceptance.test.ts` (new, 1 test)
- `src/modules/core/schemas.ts` (shared, edit-only: `SetModuleEnabledSchema`'s `key` enum was missing `"library"` — predates MOD-T4/X03, blocked `core.module.set` for this module entirely, not just this test; appended one value)

Behavior implemented: one HTTP-level test: admin creates book + 2 copies; issues copy 1 to child A (200, dueOn); same copy to child B (409 conflict); teacher issue (403). Backdates A's loan 3 days; `library.overdue` shows daysOverdue 3 / fineSoFar 300 (paise); `library.myLoans` scoping (G1 sees it, G2 with A's id -> []). Admin returns -> fineCharged true, fineAmount 3; `finance.getInvoice` shows the `library_fine` line + total-paidTotal outstanding 3; `finance.listLedgerEntries` balanced true. Returning again -> 404. Owner `core.module.set` disables `library` -> issue & myLoans both 403 `MODULE_DISABLED_MESSAGE`; re-enable -> 200.

Tests run:
- `pnpm test:db tests/db/library-acceptance.test.ts` -> 1 passed
- `pnpm lint` -> clean
- `pnpm typecheck` -> clean

Tests not run and why: none; single-file db run per lane rule, no full test:db/test:security (not DB owner for this task).

Limitations / honesty label: none; no UI this milestone, nothing simulated.

Security / integration risks: none new. The `schemas.ts` fix is additive-only (one enum value); grepped — no test enumerates that schema's literal value list, so nothing else could regress.

Follow-ups: flag the `SetModuleEnabledSchema` enum as generally stale (also missing at least `"whatsapp"`, added concurrently by another lane) — a future task should derive it from `MODULE_KEYS` instead of hand-listing.

New dependencies: none.

Assumptions made: second guardian + HTTP bearer token built locally (mirrors `operations-acceptance.test.ts`'s `addGuardianWithChild`, not exported there); G1/A link via direct `guardian_students` insert (mirrors `library-rls.test.ts`); invoice fixture mirrors T6's `setupPaidInvoice` (term 2020-01-01..2030-03-31, always "current").
