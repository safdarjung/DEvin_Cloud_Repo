# X03-T7 Report: Library queries

Packet: X03-T7 Library queries (Sonnet)
Files changed:
- `src/modules/library/queries.ts` (new, 251 lines)
- `src/modules/library/query-defs.ts` (new, 29 lines)
- `tests/db/library-queries.test.ts` (new, 253 lines, 6 tests)
- `src/app/api/v1/query/all-queries.ts` (+1 import line)
- `tests/db/api-query-route.test.ts` (+3 smoke samples: library.catalog/overdue/myLoans)

Behavior implemented: `library.catalog` (library.manage) — title/author ilike (escaped) or normalised-ISBN-exact, per-book active/available copy counts. `library.overdue` (library.manage) — open loans past due, dueOn asc, fineSoFar = daysOverdue x fine_per_day in integer paise, 0 for staff. `library.myLoans` (library.read) — studentId arg / own staffId / RLS-shown student loans, open-first then returned desc, max 50.

Tests run:
- `pnpm test:db tests/db/library-queries.test.ts` -> 6 passed
- `pnpm test:db tests/db/api-query-route.test.ts` -> 4 timed out at the file's own 5000ms default (unrelated tests + the smoke test, pre-existing DBT-46 auth-under-load pattern per T2/T3 reports), retried once, same; re-ran with `--testTimeout=30000` -> 7 passed incl. owner smoke (my 3 library.* samples returned non-internal). Did not raise the file's default timeout (shared file, out of scope).
- `pnpm lint` / `pnpm typecheck` (touched files) -> clean

Tests not run and why: none beyond the above.

Limitations / honesty label: none; no UI this milestone, nothing simulated.

Security / integration risks: none new; queries are read-only, permission-gated (library.manage/library.read), RLS does real scoping — myLoans' lack of an explicit non-staff/non-studentId filter relies on RLS (manager roles could see the whole institution via that query if they have no staffId, same as RLS already allows on the table directly).

Follow-ups: T9 (HTTP acceptance), T10 (docs).
New dependencies: none.
Assumptions made: fineSoFar is the only field expressed in integer paise per rulings wording; myLoans.fine stays in fine_amount's native rupees unit (ruling doesn't say paise there).
