Packet: T-M14-T8 Query lifecycle.history
Files changed: src/modules/lifecycle/queries.ts, src/modules/lifecycle/query-defs.ts (new);
  src/app/api/v1/query/all-queries.ts, tests/db/api-query-route.test.ts (edit, re-read first);
  tests/db/lifecycle-queries.test.ts (new)
Behavior implemented: lifecycleHistory(ctx, studentId) -> {enrolments, events} over
  enrolments (+academic_years/class_sections/grades) and student_lifecycle_events, each
  sorted (startedOn / createdAt). Registered as query `lifecycle.history`, permission
  student.read, RLS-only narrowing (no institution-write checks). LANE B: no `module`
  field (MOD not in this tree, per M14-tasks.md header ruling) — deviates from rulings'
  literal `module: "student_lifecycle"` line, intentionally, per lane override.
Tests run: pnpm test:db tests/db/lifecycle-queries.test.ts -> 4/4 pass;
  pnpm test:db tests/db/api-query-route.test.ts -> 7/7 pass; pnpm lint -> clean;
  pnpm typecheck -> clean for touched files.
Tests not run and why: full test:db / db:reset / db:types / seed (lane rule: own files only).
Limitations / honesty label: none (plain data read, no AI/simulated path).
Security / integration risks: none introduced; relies entirely on existing 0025/0076 RLS,
  verified empty-result cases for unrelated guardian and non-teaching teacher.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: grade/section rendered as separate fields (grades.code, class_sections.name),
  matching existing queries.ts precedent (timetable/attendance/exams), not a combined label.
Pre-existing typecheck errors in src/modules/lifecycle/actions.ts (T6, not touched here) —
  not mine, named per brief.
