Packet: M10-T6 Acceptance over HTTP
Files changed: tests/db/curriculum-acceptance.test.ts (new)
Behavior implemented: HTTP acceptance test mirroring timetable-acceptance.test.ts.
Admin POSTs curriculum.unit.upsert x4; teacher POSTs lessonPlan.upsert then
markCovered x2 (2/4), then covered:false (1/4) via principal's
coverageBySection reads. Teacher of another subject and guardian ->
markCovered 403 forbidden. Guardian sectionUnits: own child's section shows
coveredOn, unrelated section -> []. Guardian coverageBySection -> 403.
Tests run: pnpm test:db tests/db/curriculum-acceptance.test.ts -> 1 file, 1 test, passed.
pnpm lint -> clean (exit 0). pnpm typecheck -> clean (exit 0).
Tests not run and why: no full test:db/test:security/db:reset (brief: own file only, no DB-owner actions).
Limitations / honesty label: n/a (no AI, no simulated channel).
Security / integration risks: none found; RLS/permission denials (403) all behaved as T1/T3 rulings specify.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: none — prerequisite files (T1 migration, T2 schemas, T3 actions,
T4 queries, T5 seed) were already present in the tree when this task started.
