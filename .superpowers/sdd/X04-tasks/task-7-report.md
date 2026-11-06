Packet: X04-T7 Query `feePlans.ledgerExport` (Tally + plain CSV)

Files changed: tests/db/fee-plans-export.test.ts (fixed type error, pre-existing from interrupted run).

Behavior implemented: Found `ledgerExport`, `TallyRow`, `PlainLedgerRow` already fully implemented in src/modules/fee-plans/queries.ts, registered in query-defs.ts, imported in all-queries.ts, and smoke sample already in tests/db/api-query-route.test.ts — all from an earlier interrupted run. Only tests/db/fee-plans-export.test.ts existed untracked, uncommitted, with one typecheck error (line 136 cast `(typeof rows)[number][]` collapsed the TallyRow|PlainLedgerRow union, `row.Date` didn't typecheck on PlainLedgerRow branch). Fixed: import `TallyRow` type from queries.ts, cast loop var to `TallyRow[]` directly.

Tests run: `pnpm test:db tests/db/fee-plans-export.test.ts` -> 7/7 pass. `pnpm test:db tests/db/fee-plans-export.test.ts tests/db/api-query-route.test.ts` -> 14/14 pass. `pnpm lint` -> 0 errors (8 pre-existing warnings in untouched tests/unit/mastery-schemas.test.ts). `pnpm typecheck` -> clean (was 1 error before fix).

Tests not run and why: full test:security/test:db suites not run (non-owner; packet scopes to the 2 files above per BRIEF-COMMON).

Limitations / honesty label: Tally layout `<LimitedBadge>` per ruling — no UI yet (Workstream D), so label not wired here; query layer only.

Security / integration risks: none. Only file touched outside task scope is the task's own new test file (fix only, no registry edits).

Follow-ups: none new.

New dependencies: none.

Assumptions made: no code changes needed beyond the test-file type fix — T7's query/export code was already complete and correct from the prior interrupted run.
