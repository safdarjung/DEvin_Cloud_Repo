### Task 4: M07-T4 Timetable actions
READ: BRIEF-COMMON.md; rulings; Task 2 migration; Task 3 schemas; `src/modules/notifications/announcements.actions.ts` (style, 42501/23505 mapping)
FILES: `src/modules/timetable/actions.ts` (`"use server"`); `tests/db/timetable-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (all `timetable.manage`, audited ids/counts only): `timetable.room.upsert`; `timetable.period.upsert`; `timetable.version.create` (optional copy of another version's slots); `timetable.saveDraft` (deletes slots of `replaceSectionIds` in the draft, inserts `slots`; one bad slot fails the call with `conflict` + `fieldErrors.slots: ["<index>: teacher|room|section double-booked"]`); `timetable.publish` → RPC.
TEST FIRST: build rooms/periods/version, save, publish; teacher double-booked → conflict naming teacher; teacher role → forbidden; saveDraft on a published version → invalid_state.
ACCEPT: `pnpm test:db tests/db/timetable-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

