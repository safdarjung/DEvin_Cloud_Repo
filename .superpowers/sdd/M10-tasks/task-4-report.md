Packet: M10-T4 Curriculum queries (coverageBySection, sectionUnits, lessonPlans)
Files changed: src/modules/academics/curriculum.queries.ts (new), curriculum.query-defs.ts (new),
  tests/db/curriculum-queries.test.ts (new); + src/app/api/v1/query/all-queries.ts (import line),
  tests/db/api-query-route.test.ts (3 smoke sample lines)
Behavior: coverageBySection (staff-only, forbidden for guardian/student, 5 fixed queries, on_track
  via institution-local elapsed-year math); sectionUnits (per-section units + coveredOn, RLS-scoped);
  lessonPlans (section plans, optional subject/date range, limit 500). Exact CurriculumCoverage shape.
Tests run: pnpm test:db tests/db/curriculum-queries.test.ts -> 5 passed
  pnpm test:db tests/db/api-query-route.test.ts -> 7 passed (smoke incl. 3 new queries, none internal)
Tests not run: tests/db/curriculum-actions.test.ts, curriculum-rls full db:reset — not this task's
  files/DB-owner scope (brief: own test files only).
Limitations: none known.
Security/integration risk: none — read-only, RLS is the real filter, defense-in-depth institution_id
  filters added same as every other queries.ts.
Follow-ups: none new (debt rows already listed in T7).
New dependencies: none.
Assumptions: T1 migration/types and T2 schemas already landed (confirmed on disk); T3 actions not yet
  present — not a dependency of T4 per routing. Not touched; lint/typecheck pre-existing errors in
  curriculum.actions.ts (T3, concurrent) and timetable/substitution.actions.ts (unrelated) ignored.
