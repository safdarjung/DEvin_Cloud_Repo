Packet: T-0NN M08-T11 HR queries (staffAvailabilityToday, pendingLeaveApprovals, leaveRequests, staffAttendanceForDate + helpers)
Files changed: src/modules/people/hr.queries.ts (new), src/modules/people/hr.query-defs.ts (new), tests/db/hr-queries.test.ts (new), src/modules/attendance/queries.ts (one-word export on todayInInstitutionTimezone), src/app/api/v1/query/all-queries.ts (+1 import line), tests/db/api-query-route.test.ts (+4 smoke samples)
Behavior: 4 queries registered under people.* + 2 plain helpers (staffUnavailableOn, approvedLeaveDates), per rulings. RLS does all row-scoping; TS re-derives admin-vs-own for staffAttendanceForDate only (RLS can't express "all active staff" vs "own row" from one table read).
Tests run: pnpm test:db tests/db/hr-queries.test.ts tests/db/api-query-route.test.ts -> 12/12 pass (5 new + 7 existing). pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run: full test:db/test:security (non-owner; brief forbids). T12 depends on this task and wasn't touched.
Limitations/honesty: no UI this milestone (per rulings); nothing to label.
Security/integration risks: none found. staffAttendanceForDate's own-row path needs staff.user_id set (fixture gap in createTestInstitution, worked around in the test like documents-rls.test.ts does — not a prod issue, real staff rows get user_id via invite accept).
Follow-ups: none new.
New dependencies: none.
Assumptions: StaffAvailability/ApprovalRow types reused as-is from the widget files (no new types.ts edits needed); leaveRequests default limit 50 (not specified, mirrors other list queries' PAGE_SIZE pattern).
