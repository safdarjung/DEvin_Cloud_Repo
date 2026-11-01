Packet: M07-T5 Timetable queries

Files changed:
- src/modules/timetable/queries.ts (new)
- src/modules/timetable/query-defs.ts (new)
- src/app/api/v1/query/all-queries.ts (+1 import line)
- tests/db/timetable-queries.test.ts (new)
- tests/db/api-query-route.test.ts (+7 sample-input lines)

Behavior implemented:
- `timetable.forSection` / `forTeacher` / `forStudent`: weekly grid rows `{ weekday, period, subject, teacher, room }` (+`section` for forTeacher). Default version = current academic year's published one; forStudent resolves the student's active enrolment (RLS decides visibility — a guardian outside the family reads no enrolment row, so returns `[]`).
- `timetable.todayFor`: institution-timezone weekday/time, full bell schedule (breaks included) with `isCurrent`/`isNext`, replacing `demoTimetable`. Teacher → own slots; guardian/student → first child/own section; every other role/Sunday → bare schedule or `[]`.
- `timetable.conflicts` / `teacherWorkload` / `roomUtilisation` (require `timetable.manage`): `room_capacity` (room smaller than active section strength) + `teacher_unavailable` (over `settings.timetable.max_periods_week`, default 36) — no double-booking kind, since that's a DB constraint per rulings; workload counts periods/week + distinct subjects/sections per teacher; roomUtilisation periods_total = 6 × non-break periods.

Mid-task controller amendment handled: migration 0069 gained `timetable_slots.subject_id` (not null FK) — rewrote `fetchSlots`/`teacherWorkload` to read subject directly instead of inferring via `subject_assignments`; updated test fixtures' `createSlot` helper (+subjectId arg) and all 5 call sites.

Tests run:
- `pnpm test:db tests/db/timetable-queries.test.ts tests/db/api-query-route.test.ts` → 2 files, 12 tests, all pass.
- `pnpm lint` → 0 errors, 0 warnings (touched files).
- `pnpm typecheck` → clean.

Tests not run and why: `pnpm test:security`, `pnpm test:db` (full suite) — not my file per BRIEF-COMMON single-file rule; other packets own those.

Limitations / honesty label: none (read-only query module, no UI). roomUtilisation has no dedicated unit test (only the owner smoke sample) — not in the brief's TEST FIRST list; low risk, it's a straight aggregate.

Security / integration risks: none new — RLS (0069) is the real filter; every query is defense-in-depth institution_id/version_id scoped, no service-role use.

Follow-ups: none for this task.

New dependencies (justification): none.

Assumptions made: (1) `forTeacher`/`forStudent` output extends `forSection`'s shape with an extra optional `section` field (brief only specified forSection's shape explicitly) — minimal, reuses one internal fetch path. (2) Non-staff/non-teacher/non-guardian/non-student roles calling `todayFor` get the bare bell schedule with no slot data (brief didn't define this case).

Not touched (per scope): src/modules/timetable/actions.ts, all-actions.ts, tests/security/escalation.test.ts (actions-agent's files), scripts/seed/** (seed-agent's files) — observed uncommitted in `git status` but did not read/depend on their contents beyond the already-amended migration 0069 and regenerated types.ts.
