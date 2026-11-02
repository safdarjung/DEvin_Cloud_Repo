Packet: T-12 M13-T12 Acceptance over HTTP
Files changed: tests/db/operations-acceptance.test.ts (new)
Behavior: single HTTP acceptance test. Admin builds vehicle/route/3 stops,
assigns child A (G1) -> stop2, child B (G2) -> stop3. G1 transport.forStudent:
A -> stop2, B -> null; G1 PostgREST transport_stops -> only stop2 (G2 sanity:
only stop3). Admin declares holiday + staff-only event today; admin
attendance.mark today -> 409 invalid_state; guardian calendar.forRole has
holiday title, not staff event. Teacher maintenance.request -> admin
maintenance.assign -> maintenance.close -> teacher facilities.maintenanceRequests
shows done.
Tests run: pnpm test:db tests/db/operations-acceptance.test.ts -> 1 passed.
pnpm lint -> clean. pnpm typecheck -> clean.
Tests not run: full test:db/test:security (non-owner; brief says own file only).
Limitations: "module disabled -> forbidden" sub-test skipped per LANE B NOTE
(MOD not merged in this worktree, no toggle exists) — controller ruling override.
Security/integration risk: none found; all actions/queries/RLS already in
place from T2-T11, this task only adds the acceptance test.
Follow-ups: none new.
New dependencies: none.
Assumptions: default academic year (2026-04-01..2027-03-31) covers "today"
(2026-11-03); reused ATTENDANCE_STATUSES pattern from attendance-actions.test.ts.
