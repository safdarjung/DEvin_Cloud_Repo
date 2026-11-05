Packet: M16-T6 `timetable.todayFor` — selected student + teacher subtitle
Files changed: src/modules/timetable/queries.ts; src/modules/timetable/query-defs.ts; tests/db/timetable-queries.test.ts
Behavior implemented:
- `timetableTodayFor(ctx, studentId?)`: with `studentId`, grid = that student's active-enrolment section via new private `activeSectionIdForStudent` (shared with `timetableForStudent`, same RLS-scoped enrolment read). Unseen student → no enrolment row → bell schedule only, no subjects/subtitle.
- Without `studentId`: unchanged (teacher own slots; guardian/student first child/own section; others bare bell schedule).
- Teacher's own rows: `subtitle` = slot section name; other roles keep teacher name.
- `timetable.todayFor` query-def schema: `z.object({ studentId: uuid.optional() }).strict()`; `schemas.ts` untouched.
Tests run:
- `pnpm test:db tests/db/timetable-queries.test.ts` → 7 passed (7). New cases: guardian second child → that child's subjects; another family's child → period names, no subtitle; teacher subtitle = "A" (section); existing `{}` cases unchanged.
- `pnpm test:db tests/db/api-query-route.test.ts` → 1 failed | 6 passed (7). Failure = `core.dashboard.finance` / `core.dashboard.admissions: no sample input mapped` (T8, in-flight, not my files). `timetable.todayFor: {}` sample already present and passes.
- `pnpm typecheck` → clean. `pnpm exec eslint` on the 3 touched files → clean.
Tests not run and why: full `pnpm lint`/`test:db` — lane rule (own files only).
Limitations / honesty label: none; no badge change.
Security / integration risks: `studentId` path relies on RLS on `enrolments` (guardian sees only own children's rows); no explicit membership check beyond `getTenantContext`. Slot read for that section further narrowed by `timetable_slots` RLS.
Follow-ups: T12 portal swap consumes `timetableTodayFor(ctx, selection.studentId)`.
New dependencies (justification): none
Assumptions made: earlier interrupted run's edits were complete except `slotsBySeq` map type (`SectionTimetableSlot` → `TeacherTimetableSlot`, fixes TS2339 on `slot.section`); kept them.
