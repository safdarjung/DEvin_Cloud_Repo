Packet: X08-T6 PTM queries
Files changed: src/modules/ptm/queries.ts (new), src/modules/ptm/query-defs.ts (new), tests/db/ptm-queries.test.ts (new); src/app/api/v1/query/all-queries.ts (+1 import, shared); tests/db/api-query-route.test.ts (+3 smoke samples, shared)
Behavior implemented: `ptm.events` (ptm.slot.manage) — RLS-scoped event list, event_date>=today default, includePast drops it, classSectionIds via ptm_event_sections join. `ptm.teacherSchedule` (ptm.slot.manage) — slot grid for one teacher/event, startsAt/endsAt derived (day_starts_at+seq*slot_minutes, never stored), booked child name+section via ptm_bookings->students->enrolments; staffId defaults to caller's own, another staffId needs ptm.manage else forbidden, no resolvable staffId -> validation_failed. `ptm.forStudent` (ptm.book) — thin wrapper over the `ptm_slots_for_student` definer (mine/taken/open states, guardian-of-child check in SQL -> forbidden).
Tests run: `pnpm test:db tests/db/ptm-queries.test.ts` -> 7 passed; `pnpm test:db tests/db/api-query-route.test.ts` -> 7 passed; `pnpm lint` clean (2 pre-existing warnings in survey-queries.test.ts, not mine); `pnpm typecheck` clean.
Tests not run and why: full `pnpm test:security` / `pnpm db:reset` (not DB owner for this task; brief forbids).
Limitations / honesty label: none new (X08 honesty label is T11's job).
Security / integration risks: none identified; reads rely on 0099 RLS + the existing ptm_slots_for_student definer, no new SQL.
Follow-ups: none for T6. T9 acceptance test, T11 docs still pending.
New dependencies (justification): none
Assumptions made: reused `toHHMM`/`todayInInstitutionTimezone` from timetable/attendance queries (existing cross-module precedent) rather than redefining; section label format "Grade VI-A" matches existing `grades.display_name` convention (people/queries.ts), not the shorter "VI-A" used elsewhere in SQL comments.
