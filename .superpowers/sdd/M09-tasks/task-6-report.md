Packet: T-6 M09-T6 Queries academics.submissionsForAssignment + mySubmissions
Files changed: src/modules/academics/submissions.queries.ts (new), src/modules/academics/query-defs.ts (edit, append-only: 2 defineQuery), tests/db/submissions-queries.test.ts (new), tests/db/api-query-route.test.ts (edit, append-only: 2 smoke samples)
Behavior implemented: submissionsForAssignment(ctx, assignmentId) — roster of active enrolments for the assignment's section, left-joined submission, documentCount via one .in() query, not_submitted rows flag isLate from dueAt. mySubmissions(ctx, studentId?) — reuses listStudentAssignments, resolves studentId ?? ctx.membership.studentId (null -> []), left-joined submission + documentCount.
Tests run: pnpm test:db tests/db/submissions-queries.test.ts -> 4 passed; pnpm test:db tests/db/api-query-route.test.ts -> 7 passed (incl. smoke); pnpm lint -> 0 errors (2 pre-existing warnings, other files); pnpm typecheck -> no errors in touched files (unrelated pre-existing errors in timetable/substitution.actions.ts, tests/db/leave-actions.test.ts — other packets, not touched here).
Tests not run and why: db:reset/db:types/full test:db/test:security per brief (not DB owner for this task).
Limitations / honesty label: n/a — real feature, no badge.
Security / integration risks: none new; reads go through RLS client, explicit institution_id filters are defense-in-depth only, matching existing module pattern.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: guardian cross-family [] relies on RLS narrowing `enrolments`/`assignment_submissions` via my_student_ids() inside reused listStudentAssignments (same pattern as timetable.forStudent) — verified with test.
