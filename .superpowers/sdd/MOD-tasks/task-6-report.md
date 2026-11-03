Packet: MOD-T6 Retrofit: people, attendance, finance, notifications, imports, documents, jobs, AI usage

Files changed:
- src/modules/people/actions.ts (5 definitions, 5 modules added)
- src/modules/people/query-defs.ts (5 definitions, 5 modules added)
- src/modules/people/staff-attendance.actions.ts (2 definitions, 2 modules added)
- src/modules/people/leave.actions.ts (4 definitions, 4 modules added)
- src/modules/people/hr.query-defs.ts (4 definitions, 4 modules added)
- src/modules/attendance/actions.ts (4 definitions, 4 modules added)
- src/modules/attendance/query-defs.ts (7 definitions, 7 modules added)
- src/modules/finance/actions.ts (5 definitions, 5 modules added)
- src/modules/finance/query-defs.ts (13 definitions, 13 modules added)
- src/modules/notifications/actions.ts (1 definition, 1 module added)
- src/modules/notifications/query-defs.ts (3 definitions, 3 modules added)
- src/modules/imports/actions.ts (2 definitions, 2 modules added)
- src/modules/imports/query-defs.ts (1 definition, 1 module added)
- src/modules/documents/actions.ts (4 definitions, 4 modules added)
- src/modules/documents/query-defs.ts (1 definition, 1 module added)
- src/modules/jobs/actions.ts (1 definition, 1 module added)
- src/modules/jobs/query-defs.ts (1 definition, 1 module added)
- src/modules/ai/query-defs.ts (1 definition, 1 module added)

Behavior: Added `module: "KEY",` line after `name:` in all defineAction/defineQuery definitions. Mapping: people/* → "people" except staff-attendance.actions.ts/leave.actions.ts/hr.query-defs.ts → "staff_attendance"; attendance: mark/submit/correct/getTodaySectionsForTeacher/getSession/getStudentAttendanceSummary/attendanceTodaySummary/sectionsBelowThreshold/getSectionAttendancePatterns → "attendance", markPeriod/periodSummary → "timetable"; finance/* → "fees"; notifications/* → "notifications"; imports/documents/jobs/* → "core"; ai.usageSummary → "core".

Tests: `pnpm test tests/unit/define-action.test.ts tests/unit/action-names-unique.test.ts` → 2 files, 25 tests passed. Self-check: 64 total definitions, 64 modules (100% coverage).

Limitations: None. No new dependencies. No assumptions made.
