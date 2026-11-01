Packet: T-0NN M07-T4 Timetable actions
Files changed:
- src/modules/timetable/actions.ts (new)
- tests/db/timetable-actions.test.ts (new)
- src/app/api/v1/actions/all-actions.ts (+1 import line)
- tests/security/escalation.test.ts (+5 C-03 fixtures)

Behavior implemented: timetable.room.upsert, timetable.period.upsert (update-if-id-else-insert, 23505 -> conflict), timetable.version.create (optional slot copy from another version), timetable.saveDraft (delete replaceSectionIds then bulk insert; 23505 -> conflict with fieldErrors.slots naming teacher|room|section + best-effort index parsed from the Postgres error detail; 42501 -> validation_failed; version not draft checked upfront -> invalid_state), timetable.publish (thin publish_timetable RPC wrapper, mapSqlError handles forbidden/invalid_state/not_found).

Tests run:
- `pnpm test:db tests/db/timetable-actions.test.ts` -> 4/4 pass
- `pnpm test tests/unit/action-names-unique.test.ts` -> 4/4 pass
- `pnpm test:security tests/security/escalation.test.ts` -> 692/692 pass
- `pnpm lint` -> clean; `pnpm typecheck` -> clean

Tests not run and why: tests/db/timetable-queries.test.ts, tests/db/seed-timetable.test.ts, tests/db/api-query-route.test.ts — owned by the two parallel agents (queries/seed), not touched or re-run by me.

Limitations / honesty label: n/a (backend action layer, no UI).

Security / integration risks: saveDraft's delete-then-insert is two separate statements (not one DB transaction) — if insert fails after delete, replaceSectionIds' old slots are gone until a retry; documented in-file, same accepted trade-off as announcements.actions.ts's createAnnouncement. Insert-conflict index detection parses the Postgres error `details` string (column/value pairs) to map back to the offending array index; falls back to index 0 if parsing doesn't match — never blocks the conflict itself, only the message precision.

Follow-ups: schema/migration gap — RoomUpsertSchema.kind and SlotInputSchema.subjectId are valid per schemas.ts (T3) but have no matching column on rooms/timetable_slots (migration 0069, T2); both are accepted+validated by this action layer and then dropped (not persisted). Subject is intended to be derived later (T5 queries) via subject_assignments(class_section_id, teacher_id) join. Flagging for 12-decision-log.md §Debt — not fixed here (not this packet's files).

New dependencies (justification): none.

Assumptions made: saveDraft validates version status itself (not_found / invalid_state) before any write, rather than relying solely on the DB's guard_timetable_slots_write trigger, for a clean error without a partial delete attempt. Did not add extra validation of SlotInput.subjectId against subject_assignments (not in TEST FIRST list, no column to check against meaningfully — field is boundary-validated by T3's schema and otherwise unused here).

Fix note (round 2): coordinator amended migration 0069 to add `rooms.kind` (not null, default 'classroom') and `timetable_slots.subject_id` (not null, references subjects(id), institution-bound in insert/update policies); types.ts regenerated, local timetable rows wiped. Changes:
- src/modules/timetable/actions.ts: upsertRoom now writes/selects/returns `kind`; saveDraft and createVersion's copy-from-version slot insert now write `subject_id` (from SlotInputSchema.subjectId / the source row). Removed the now-stale "validated-then-dropped" comment block.
- tests/db/timetable-actions.test.ts: added a real `createSubject` per test fixture and pass its id as `subjectId` in every saveDraft slot (previously a bare `crypto.randomUUID()`, which would now fail the subject_id FK).
- tests/db/timetable-rls.test.ts (Task 2's file, fixed per coordinator's explicit request): `buildBase` now also creates a subject (`subjectId`); all 10 raw/`.insert()` slot fixtures across the file now include `subject_id` (6 were failing NOT NULL; 4 more updated for consistency, including the two cross-institution negative-test inserts which now use a same-institution subjectId so the failure stays specifically about the cross-institution teacher/room, not an unrelated NOT NULL).
Re-ran: `pnpm test:db tests/db/timetable-actions.test.ts tests/db/timetable-rls.test.ts` -> 15/15 pass; `pnpm test:security tests/security/escalation.test.ts` -> 692/692 pass; `pnpm lint` -> clean; `pnpm typecheck` -> clean.
