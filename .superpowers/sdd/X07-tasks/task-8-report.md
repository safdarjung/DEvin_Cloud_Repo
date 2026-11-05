# X07-T8: Visitors queries

Packet: T-008 Visitors queries (X07-T8)

Files changed:
- `src/modules/visitors/queries.ts` (new): `visitorsList`, `visitorsGatePasses`, `visitorsPickupList`
- `src/modules/visitors/query-defs.ts` (new): `visitors.list`, `visitors.gatePasses`, `visitors.pickupList`
- `tests/db/visitors-queries.test.ts` (new, 7 tests)
- `src/app/api/v1/query/all-queries.ts` (+1 import line, append only)
- `tests/db/api-query-route.test.ts` (+3 sample-input lines, append only)

Behavior implemented: all three reads per rulings. `visitors.list`: date filter uses the institution-local calendar day via a UTC day-range (own `dayRangeInTimezone` helper, offset math mirrors `src/lib/ai/usage.ts`), absent date = latest 200 desc; `onSite` excludes checked-out; `meetingWith` = host staff full_name ?? meeting_with. `visitors.gatePasses`: same date/latest-200 shape on `requested_at`; `class` from the student's active enrolment (`${grade.code}-${section.name}`); RLS narrows a teacher to own-section students. `visitors.pickupList`: linked guardians (primary first) then pickup_persons (created_at), phones masked to last 4; rows RLS hides are absent.

Tests run: `pnpm test:db tests/db/visitors-queries.test.ts` -> 7/7 pass. `pnpm test:db tests/db/api-query-route.test.ts` -> 7/7 pass (owner smoke, all registered queries incl. the 3 new ones). `pnpm lint` clean. `pnpm typecheck` clean (repo-wide).

Tests not run and why: full `pnpm test:db` / `test:security` — not my DB-owner slot (brief: single-file runs only).

Limitations / honesty label: none new; no UI (Workstream D per rulings).

Security / integration risks: found and worked around in-test, not in product code — `guardians_select` RLS (0004/0020, hosted-applied, frozen) has no "guardian reads own guardian row" branch; `guardians.user_id` is only backfilled by the invitation-accept RPC (0079), which `createTestInstitution` doesn't run. My own-pickup test sets `guardians.user_id` directly to simulate a claimed account. Flagging for the record, not fixing (out of packet scope, no migration allowed here) — a real guardian whose invite flow set `user_id` sees their own name fine; one who never went through that RPC would see `fullName: ""` for their own guardian row in `pickupList`.

Follow-ups: none new beyond the flagged RLS gap above (debt candidate for people module, 12-decision-log.md).

New dependencies: none. Assumptions: `pickupList` permission is `student.read` per rulings (RLS scopes it); smoke-test sample inputs use a random UUID, matching every other query's precedent.
