Packet: M08-T5 HR Zod schemas (people/hr.schemas.ts) + unit test
Files changed: src/modules/people/hr.schemas.ts (new), tests/unit/hr-schemas.test.ts (new)
Behavior implemented: 7 Zod schemas (.strict()) for HR actions: StaffAttendanceMarkSchema, CheckInSchema, LeaveRequestSchema, LeaveDecisionSchema, LeaveCancelSchema, LeaveListSchema, StaffAttendanceForDateSchema. Inferred *Input types from each. RefreshToken validations: leave endDate ≥ startDate, ≤31 days inclusive; records 1–300; note ≤200; reason 1–500; limit 1–200. Status enum present|absent|late|half_day only (on_leave rejected). All reject unknown keys.
Tests run: `pnpm test tests/unit/hr-schemas.test.ts` → 37 passed; `pnpm lint --fix` + `pnpm typecheck` clean.
Tests not run and why: Full test suite not run (task scope); db tests not applicable (no DB queries).
Limitations / honesty label: None; schemas are fully testable and exported.
Security / integration risks: None identified. Input validation is tight; relative .ts imports ensure seed script safety.
Follow-ups: None.
New dependencies: None.
Assumptions made: Leave period calc: end_date - start_date (days) + 1 ≤ 31. Unknown keys in input rejected by .strict() per spec.
