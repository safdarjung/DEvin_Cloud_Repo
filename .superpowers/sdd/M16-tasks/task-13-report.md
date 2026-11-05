# M16-T13 Delete the four fixtures

Packet: T-13 Delete the four fixtures

Files changed:
- `src/modules/core/demo/fixtures.ts`
- `tests/unit/demo-fixtures.test.ts`
- `scripts/seed/sections/timetable.ts`

Behavior implemented: Deleted four fixture functions (demoTimetable, demoAttendanceTrend, demoStaffAvailability, demoApprovals) and all supporting code (rng, pick, TZ, ist, label, parts, hhmm, SLOTS, STAFF, APPROVALS, ageLabel, and widget type imports). Kept demoFixturesEnabled, InsightRole, InsightFacts, demoInsights, and header comment. Updated seed comments to inline times (08:00–14:10 IST, 45-min periods, 15-min break, 40-min lunch) instead of referencing fixtures.ts.

Tests run: `pnpm test tests/unit/demo-fixtures.test.ts` → Test Files 1 passed (1), Tests 3 passed (3)
`pnpm lint` on touched files → clean
`pnpm typecheck` → clean

Gate: `grep -rnE "demo(Timetable|AttendanceTrend|Approvals|StaffAvailability)\(" src tests e2e scripts` → empty

Limitations / honesty label: None. Deletion complete.

Security / integration risks: None. Functions deleted, no breaking changes to non-deleted code.

Follow-ups: None.

New dependencies: None.

Assumptions made: All four functions were replaced by real queries in prior tasks (T4, T5, T6-T9, T10-T12).
