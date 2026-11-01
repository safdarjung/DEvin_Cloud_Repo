### Task 4: M02-T4 attendance + admissions + core query defs
READ: BRIEF-COMMON.md; Task 3 rules (in this file); `src/modules/{attendance,admissions}/queries.ts`; `src/modules/core/dashboard.queries.ts`
FILES: `src/modules/attendance/query-defs.ts` (new); `src/modules/admissions/query-defs.ts` (new); `src/modules/core/query-defs.ts` (new) — and one import line each in `all-queries.ts` (allowed 4th file, 3 lines)
EXPORTS: every exported async ctx fn per Task 3 rules (`getSectionAttendancePatterns` included, name `attendance.getSectionAttendancePatterns`); core → `core.getDashboardData {}`.
TEST FIRST: the T3 completeness test must go RED before the imports are added, GREEN after.
ACCEPT: `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`

