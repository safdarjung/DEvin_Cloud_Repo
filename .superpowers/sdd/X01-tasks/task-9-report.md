Packet: X01-T9 Diary queries
Files changed:
- src/modules/diary/queries.ts (new)
- src/modules/diary/query-defs.ts (new)
- tests/db/diary-queries.test.ts (new)
- src/app/api/v1/query/all-queries.ts (+1 import line)
- tests/db/api-query-route.test.ts (+3 sample inputs: diary.forSection/forStudent/ackStatus)

Behavior implemented: diary.forSection (assignment.read) — window default today-6..today+7, newest entry_date then created_at, ackCount null unless caller holds diary.write; diary.forStudent (assignment.read) — resolves active enrolment, [] if RLS hides it, adds acknowledged; diary.ackStatus (diary.write) — section's active students by roll_no with ack/ackedAt, not_found if entry invisible under RLS.

Tests run: `pnpm test:db tests/db/diary-queries.test.ts` → 6/6 passed. `pnpm test:db tests/db/api-query-route.test.ts` → 6/7 passed; the 1 failure (`survey.results` P0001, and `studentLeave.list` unmapped on a combined run) is pre-existing/other-packet (X08 survey lane; T7 studentLeave queries not yet landed) — none of the 3 new diary.* samples appear in the failing list. `pnpm lint` clean. `pnpm typecheck` clean.

Tests not run and why: none blocked.

Limitations / honesty label: none; no UI, no badge.

Security / integration risks: none new — read-only, RLS is the only row filter per rulings; ackCount/ackedEntryIds queries scoped by institution_id + entry_id batch, piggyback on existing diary_acknowledgements RLS.

Follow-ups: none for T9.

New dependencies: none.

Assumptions made: forSection/forStudent order ties (same entry_date) broken by created_at desc (both "newest first"); forStudent's ackCount stays null per the same diary.write rule as forSection (student/guardian callers never hold it in practice).
