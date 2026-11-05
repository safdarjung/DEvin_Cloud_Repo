Packet: X06-T6 Queries `examSeating.slots`, `examSeating.chart`, `examSeating.studentSeats`

Files changed:
- `src/modules/exam-seating/queries.ts` (new)
- `src/modules/exam-seating/query-defs.ts` (new)
- `tests/db/exam-seating-queries.test.ts` (new)
- `src/app/api/v1/query/all-queries.ts` (+1 import line)
- `tests/db/api-query-route.test.ts` (+3 owner-smoke sample lines)

Behavior implemented: `listSeatingSlots` (distinct `scheduled_at` of the exam's papers, section coverage/labels, active student count, current-plan info, `stale` per rulings — compares sorted `section_ids` and `seat_count` against live data); `getSeatingChart` (plan header + seats grouped by room in the plan's resolved room order, seat_no order, rollNo from `enrolments`, RLS narrows seat rows for guardian/student); `listStudentSeats` (current-plan seats only, `slot_start > now()-24h`, capped 100). All three registered as `examSeating.slots/.chart/.studentSeats` (module `exam_seating`, permission `exam.seating.read`).

Tests run: `pnpm test:db tests/db/exam-seating-queries.test.ts` → 3/3 pass (slots null→set→stale; chart room order/rollNo/sectionLabel; guardian own-child-only/other-family-empty/superseded-never-reached; teacher forbidden). `pnpm test:db tests/db/api-query-route.test.ts` → 7/7 pass (owner smoke covers all 3 new queries, none `internal`). `pnpm lint` clean. `pnpm typecheck` 0 errors.

Tests not run: `tests/db/api-query-route.test.ts` run together with my file above (10/10), not the full `test:db` suite (DB-owner rule — single-file runs only).

Limitations / honesty label: n/a (API layer, no UI; feature stays `limited` per rulings).

Security / integration risks: none new — RLS (T2) is the real filter; `institution_id` eq's here are defense in depth. `getSeatingChart`'s room-name lookup queries `rooms` directly (staff-facing use); not exercised for guardian/student in this packet's tests.

Follow-ups: T8 (`examSeating.chartHtml`/`admitCardsHtml` queries, reuses `getSeatingChart`).

New dependencies: none.

Assumptions made: timestamptz round-trips through supabase-js as `...+00:00`, not the `Z`-suffixed literal a caller wrote — slot lookups/comparisons use `Date` equality, not string equality, inside both the implementation and the test fixtures.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
