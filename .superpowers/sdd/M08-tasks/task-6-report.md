# M08-T6: Substitution + Period-Attendance Zod Schemas — Completion Report

**Packet:** M08-T6 Substitution + period-attendance Zod schemas + unit test

**Files changed:**
- `src/modules/timetable/schemas.ts` (append 5 substitution schemas)
- `src/modules/attendance/schemas.ts` (append 2 period-attendance schemas)
- `tests/unit/m08-schemas.test.ts` (new)

**Behavior implemented:**
Zod validation schemas for M08 substitution and period-attendance features. Timetable: `SubstitutionAssignSchema`, `SubstitutionCancelSchema`, `SubstitutionCandidatesSchema`, `CoverNeededSchema`, `SubstitutionsSchema`. Attendance: `MarkPeriodAttendanceSchema`, `PeriodSummarySchema`. All `.strict()` per rule 4; attendance records reuse existing status-code pattern (max 10 chars, no values validation in schema per action-layer policy).

**Tests run:**
```
pnpm test tests/unit/m08-schemas.test.ts → 23 passed
pnpm test tests/unit/timetable-schemas.test.ts → 50 passed
pnpm lint → clean
pnpm typecheck → clean
```

**Tests not run and why:** None; all acceptance criteria covered (valid parse, bad date reject, 201 records reject, note overflow reject, unknown keys reject).

**Limitations / honesty label:** None. Schemas are validation-only; business logic (e.g., conflict checks, RLS) happens in action handlers and SQL layer.

**Security / integration risks:** None. Schemas are passive; they enforce structure only.

**Follow-ups:** None. Task complete.

**New dependencies:** None.

**Assumptions made:** Status codes remain validated at action + DB layer, not in schema (per attendance.schemas.ts comment and 06 §W5 contract).
