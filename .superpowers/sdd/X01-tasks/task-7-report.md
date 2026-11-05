Packet: X01-T7 Student leave query
Files changed:
- src/modules/student-leave/queries.ts (new)
- src/modules/student-leave/query-defs.ts (new)
- tests/db/student-leave-queries.test.ts (new)
- src/app/api/v1/query/all-queries.ts (+1 import line)
- tests/db/api-query-route.test.ts (+1 smoke sample line)

Behavior implemented: `studentLeaveRequests` (student_leave_requests, RLS-only row filter, optional status/studentId/classSectionId/from/to/limit) → `StudentLeaveRow[]` {id, studentId, studentName, classSection ("VI-A" style), startDate, endDate, days, reason, status, decidedAt, decisionNote, createdAt}; pending first then start_date desc (two ordered+limited reads concatenated, since postgrest can't ORDER BY a non-enum status predicate), default limit 50. `studentLeaveListQuery` registered (`attendance.read`, module `student_leave`).

Tests run: `pnpm test:db tests/db/student-leave-queries.test.ts` → 5/5 passed. `pnpm test:db tests/db/api-query-route.test.ts` → 7/7 passed. `pnpm lint` clean (2 pre-existing warnings in survey-queries.test.ts, not mine). `pnpm typecheck` clean.

Tests not run and why: none blocked.

Limitations / honesty label: none; no UI, no badge.

Security / integration risks: none — read-only, RLS is the only row filter, no new SQL surface.

Follow-ups: T11 (acceptance over HTTP) exercises this via the smoke test.

New dependencies: none.

Assumptions made: concurrent lane work (T6 actions, T8/T9 diary, X08 ptm) already landed in the tree when I started; I touched only my FILES, re-read all-queries.ts/api-query-route.test.ts immediately before appending my one line each.
