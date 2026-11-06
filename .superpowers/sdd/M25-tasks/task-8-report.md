Packet: M25-T8 Query timetable.suggest
Files changed: src/modules/timetable/suggest.queries.ts (new) · src/modules/timetable/query-defs.ts (Edit: +1 import, +1 def) · tests/db/timetable-suggest.test.ts (new) · tests/db/api-query-route.test.ts (Edit: +1 smoke sample)
Behavior implemented: `suggestTimetableFill(ctx, input)` — loads version (not_found/invalid_state "Suggestions apply to draft versions only."), non-break periods, in-scope sections (+ grade-code label) of the version's academic year, their subject_assignments with active teachers, institution rooms, and every slot of the version paged `.range()` in 1000s; feeds T3's pure `suggestFill`. Registered as query `timetable.suggest` (SuggestFillSchema, timetable.manage, module timetable). `maxPeriodsPerWeek` already exported in queries.ts (T3/pre-existing, no change needed).
Tests run: `pnpm test:db tests/db/timetable-suggest.test.ts tests/db/api-query-route.test.ts` → 2 files, 10 passed (3 new: fill+save-no-conflict+unchanged-slot-count, invalid_state/not_found/forbidden, 1,007-slot paging → exactly 1 suggestion for the removed cell; 7 pre-existing in api-query-route unaffected). `pnpm lint` → 0 errors (9 warnings, all in other agents' untracked files). `pnpm typecheck` → clean, 0 errors.
Tests not run and why: none of this packet's.
Limitations / honesty label: read-only query, no write; matches rulings ("never a write"). No UI.
Security / integration risks: none new — RLS unaffected, permission timetable.manage enforced via defineQuery/guardedCall (verified teacher → forbidden).
Follow-ups: none for T8. T9 covers HTTP acceptance.
New dependencies (justification): none.
Assumptions made: rooms loaded institution-wide (not version-scoped) for homeRoom text lookup, matching queries.ts's own room-join pattern elsewhere; staff.status filtered in JS after the join (no `!inner`), consistent with substitution.queries.ts precedent.
