Packet: M08-T14 Staffing acceptance over HTTP
Files changed: tests/db/staffing-acceptance.test.ts (new)
Behavior implemented: one HTTP test (actions.POST/query.GET dispatchers,
like timetable-acceptance.test.ts). Date pinned to "today" (assign needs
>=today, markPeriod needs <=today). Flow: principal marks staff attendance
-> teacher checkIn x2 (one row); teacher leave.request -> principal
approve (200 + audit leave.approved); teacher approve -> 403; principal
approve-own -> 403; staffAvailabilityToday.onLeave=1; pendingLeaveApprovals
has principal's pending; coverNeeded -> substitutionCandidates[0] assign
-> 200; same substitute, 2nd slot same weekday+period -> 409 conflict;
substitute marks period attendance -> 200; original teacher -> 403; daily
attendance.mark + getSession same section+date -> 200.
Tests run: pnpm test:db tests/db/staffing-acceptance.test.ts -> 1/1 pass.
pnpm lint clean. pnpm typecheck clean.
Tests not run and why: no test:db/db:reset/seed/db:types (not DB owner).
Limitations: substitute-side markPeriod uses "owner" repointed to the
substitute's staff row (attendance.mark held only by owner/principal/
admin/teacher; teacher is the original-teacher identity) -> exercises the
admin-bypass branch, not the RPC's non-admin substitute branch (covered
already by T4/T10 db tests). Original-teacher 403 exercises the real
forbidden branch. No UI this milestone.
Security/integration risks: none; no shared files touched.
Follow-ups: none new. New dependencies: none.
Assumptions: fixture institution has no default attendance.statuses, so
the test sets them explicitly (mirrors period-attendance-actions.test.ts).
