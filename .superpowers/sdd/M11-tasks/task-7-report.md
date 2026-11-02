Packet: T-0NN M11-T7 Queries `exams.schedule`, `exams.scheduleConflicts`
Files changed: src/modules/exams/schedule.queries.ts (new); src/modules/timetable/queries.ts (append `timetableRoomSlots`); src/modules/exams/query-defs.ts (2 defs); tests/db/exam-schedule-queries.test.ts (new); tests/db/api-query-route.test.ts (2 smoke lines)
Behavior implemented: `examSchedule` maps exam_papers (held_on not null) to ExamScheduleRow per rulings (kind/status mapping, from/to/examId/classSectionId filters, limit 500). `examScheduleConflicts` fetches an exam's scheduled papers + feeds T6's pure detector with real rows + `timetableRoomSlots` (latest published version, non-break periods). Defs: `exams.schedule` (exam.result.read), `exams.scheduleConflicts` (exam.manage). Lane B: no `module` field (MOD not merged here).
Tests run: `pnpm test:db tests/db/exam-schedule-queries.test.ts` → 3/3 pass; `pnpm test:db tests/db/api-query-route.test.ts` → 7/7 pass; `pnpm lint` clean; `pnpm typecheck` clean.
Tests not run: full `pnpm test:db` / `db:reset` / `db:types` (non-owner rule).
Limitations / honesty label: none new (no UI, no simulated channel).
Security / integration risks: none — RLS (0073, staff-only) is the actual filter; defs only gate permission. `exams.scheduleConflicts` correctly 403s a teacher (no exam.manage).
Follow-ups: none.
New dependencies: none.
Assumptions made: fixture schedules papers via direct `update exam_papers` (T5 `exam.paper.schedule` action not yet built in this tree) — acceptable, out of this task's scope.
