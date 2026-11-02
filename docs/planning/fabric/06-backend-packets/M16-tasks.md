# M16 — Dashboards on real data + approvals

Source: `07-master-plan-v1-v2.md` §3 M16. Migration `0078` (claimed; `supabase/migrations/20261028000078_dashboard_attendance_counts.sql`). No new deps. Owning module `src/modules/core` (dashboards + approvals union; every new query is registered in `src/modules/core/query-defs.ts` with `module: "core"`). `attendance` keeps its reads (new aggregate wrappers in `attendance/queries.ts`); `timetable` gains `todayFor {studentId?}`. **Prereqs merged:** M08 (`people/hr.queries.ts`, `timetable/substitution.queries.ts`, leave + staff seed, `attendance_sessions.period_id`, exported `todayInInstitutionTimezone`), M13 (`facilities/queries.ts`, `calendar/queries.ts`), MOD (`module` on `defineQuery`, `isModuleEnabled(ctx, key)`). Replaces **and deletes** these `src/modules/core/demo/fixtures.ts` functions: `demoTimetable` (`TimetablePeriod[]`, `src/components/widgets/timetable-widget.tsx`), `demoAttendanceTrend` (`{ label, value }[]`), `demoApprovals` (`ApprovalRow[]`, `approvals-widget.tsx`), `demoStaffAvailability` (`StaffAvailability`, `staff-availability-widget.tsx`). The CLAUDE.md rule 7 demo exception ends for these four. Still fixtures: `demoInsights` + `demoFixturesEnabled` (M19) and the Fabric command widgets `dailyBrief`, `priorityActions`, `forecastCards`, `riskIndicators`, `insights` (M19/M21/M25).

Rulings:
- **0078 is an aggregate, not an approvals view.** `public.attendance_daily_counts(p_institution_id uuid, p_from date, p_to date, p_class_section_id uuid default null, p_student_id uuid default null, p_by_section boolean default false) returns table (date date, class_section_id uuid, status text, n bigint)`. It is plpgsql, `stable`, **security invoker** (RLS on `attendance_records`/`attendance_sessions` is the only filter: no definer, no `07 §4` definer row), `set search_path = ''`, qualified names. `p_to < p_from` or `p_to - p_from > 91` raises `code:validation_failed`. It joins records to sessions, filters both on `institution_id = p_institution_id` and `s.period_id is null` (daily only, M08), plus the optional section or student. `class_section_id` is null unless `p_by_section`. It groups by date (and section), status, ordered by date. Revoke from public and anon; grant execute to authenticated.
  Why: `supabase/config.toml` `max_rows = 1000` silently truncates row-level reads. `attendanceTodaySummary` and `sectionsBelowThreshold` read every record of the day, and the demo tenant marks about 2,500 students a day. A 42-day trend would be about 100k rows. The aggregate returns at most 92 × statuses rows (sections × statuses for one day by section). The approvals union needs no SQL: it is two RLS-scoped TS reads, and a view could not apply the permission and module gates. The audit read RPC was already dropped in M6.
- **Approvals union** `core.approvals.pending` `{}` (permission `dashboard.view`, `module: "core"`) returns `ApprovalRow[]` exactly, with no new field. A source is skipped (never queried) unless its permission AND its module hold. RLS is unchanged.

  | kind | rows | permission | module | RLS |
  |---|---|---|---|---|
  | `leave` | the function behind M08 `people.pendingLeaveApprovals` (status `pending`), rows as returned | `leave.approve` | `staff_attendance` | 0070: owner/principal/admin, all of the institution |
  | `recheck` | `listRecheckQueue(ctx, "submitted")` + `listRecheckQueue(ctx, "under_review")` → `{ id, kind: "recheck", title: "Recheck: <subjectName>, <examName>", requestedBy: studentName, age, href: "/<slug>/exams/rechecks" }`; never the `reason` | `exam.recheck.review` | `exams` | 0009/0020 `recheck_requests` SELECT |

  Order: the leave block, then the recheck block, each oldest first (`ApprovalRow` has no timestamp; debt row). No cap. `age` uses M08's format (`"<h> h"` under 24 h, else `"<d> d"`). Dropped source: attendance corrections. 0014 applies them at once by RPC into an append-only log, so nothing awaits approval. Not built yet: `insight` (M19, `insight.review`, module `insights`) and `agent_run` (M22, `agent.approve`, module `agents`). Each of those milestones adds one row to this table and one branch to `pendingApprovals`.
- **Trend** `dashboard.attendanceTrend` (`AttendanceTrendSchema`, permission `attendance.read`, `module: "core"`) returns `TrendPoint[]`, where `TrendPoint = { label: string; value: number }` (the `demoAttendanceTrend` element; exported from `attendance/queries.ts`). The window is `days` calendar days ending today (`todayInInstitutionTimezone`). There is one point per date with at least one in-denominator record, ascending. Holidays, Sundays and unmarked days are skipped, as the fixture skipped Sundays. `label` is en-IN `d MMM` ("2 Nov"). `value` is the weighted % from the settings status weights (the existing `computeAttendancePercentage` math), 1 decimal. Scope: none = whatever RLS shows (principal: the school; teacher: own sections; guardian: own children). `classSectionId` = that section. `studentId` = running % from the window start to each date, because a single student's daily value is only 0, 50 or 100.
- **Role dashboards.** All are `module: "core"` and are composers: `Promise.all` over existing owner functions, no new SQL. A field is `null` when its permission or module is missing (the sub-read never runs). `[]` or `0` means allowed but no data. A failing sub-read fails the query (`internal`). Types are existing exported ones.
  - `dashboard.principal` `{}` (`dashboard.view`) → `DashboardDTO & { attendanceTrend: TrendPoint[] | null; approvals: ApprovalRow[]; staffToday: StaffAvailability | null }`. The trend covers 42 days and needs `attendance.read`. `approvals` = `pendingApprovals`. `staffToday` needs `staff.read` + module `staff_attendance`.
  - `dashboard.operations` `{}` (`dashboard.view`) → `{ staffToday; coverNeeded: <M08 coverNeeded row>[] | null; openMaintenance: MaintenanceRequest[] | null; upcomingEvents: CalendarEventRow[] | null }`. `coverNeeded` keeps uncovered rows only (`substitution: null`) and needs `timetable.manage` + `substitution`. `openMaintenance` = status open, at most 5, and needs `maintenance.request` + `facilities`. `upcomingEvents` = the first 5 of `calendar.forRole` and needs `academics.read` + `calendar`.
  - `dashboard.finance` `{}` (`dashboard.view`) → `{ collections: TermCollectionSummary | null; overdue: DefaulterRow[] | null }`, both needing `finance.read`. `overdue` = `dueOn < today`, top 10 by outstanding; null when there is no current term.
  - `dashboard.admissions` `{}` (`dashboard.view`) → `{ funnel: AdmissionsFunnelCounts | null; recentEnquiries: EnquiryRow[] | null }` (5 newest). Both need `admissions.enquiry.read` + `admissions`.
  - `dashboard.teacher` `{}` (`attendance.mark`, the `/today` gate) → `{ timetable: TimetablePeriod[] | null; sectionsToday: SectionOption[]; papersToMark: number | null; activeAssignments: number | null }`. `timetable` needs module `timetable`. `papersToMark` needs `exam.marks.enter` + `exams`. `activeAssignments` (status ≠ closed) needs `assignment.read` + `assignments`.
  - `dashboard.parent` (`PortalDashboardSchema`) and `dashboard.student` `{}` (both `student.read`) → `PortalDashboard = { studentId; timetable: TimetablePeriod[] | null; attendanceTrend: TrendPoint[]; attendance: StudentAttendanceSummary | null; outstandingFees: number; latestResult: <listResultsForStudent row> | null; upcomingAssignments: AssignmentSummary[] | null }`. `attendanceTrend` covers 30 days as a running %. `attendance` is for the current term. `outstandingFees` is in rupees, summed in integer paise (lesson 8). `latestResult` needs `exams`. `upcomingAssignments` = due ≥ now, at most 5, and needs `assignments`. For the parent query, if `getStudentProfile` returns null (student not visible) → `not_found`. This is the BOLA guard: never an empty `ok` dashboard for another family's child. For the student query, `ctx.membership.studentId` null → `forbidden`.
  - `DashboardDTO` module gating belongs to MOD (gate 3). M16 adds no gating to `getDashboardData`. `core.getDashboardData` stays as it is.
- **Perf budget: < 1.5 s per dashboard query.** `tests/db/dashboard-perf.test.ts` (T14) measures it on the seeded `st-josephs-demo` tenant after `pnpm db:reset`, read-only. Each call goes in-process through the real `GET /api/v1/query/<name>` handler with the seeded user's bearer token, so auth, context, module gate, permission and RLS are all included. It makes 1 warm-up call, then 3 timed calls, and asserts 200 + `ok` and median < 1500 ms. The medians go in the T14 report. Matrix:
  - principal → `dashboard.principal`, `core.approvals.pending`, `dashboard.attendanceTrend {days: 92}` (worst case);
  - admin → `dashboard.operations`; accountant → `dashboard.finance`; admissions → `dashboard.admissions`;
  - teacher.vi-a → `dashboard.teacher`; guardian.one → `dashboard.parent {first child}`; student.one → `dashboard.student`.

  An index is added (in a spare migration number) only if this test fails.
- **Page swaps are 1:1: a function replaces each fixture, with the same type.** Pages import the module functions, not the role composers. This keeps each page's per-widget `allSettled` error isolation and avoids a page rewrite; Workstream D may switch pages to the role queries. The real widgets render for every tenant (no `demo &&` gate), behind their permission + module.
  - `dashboard/page.tsx`, leader branch: `demoAttendanceTrend` → `attendanceTrend(ctx, { days: 42 })` (bars = the existing 6-chunk code; `sparkAtt` = the last 20 values). `demoApprovals` → `pendingApprovals(ctx)`. `demoStaffAvailability` → `staffAvailabilityToday(ctx)` (M08). `sparkEnq`, `sparkFee` and `sparkRes` are deleted, not replaced: they were attendance fixtures shown under other labels (debt row).
  - `today/page.tsx`: `demoTimetable` → `timetableTodayFor(ctx)`.
  - `portal/page.tsx`: `demoTimetable` → `timetableTodayFor(ctx, selection.studentId)`; `demoAttendanceTrend` → `attendanceTrend(ctx, { days: 30, studentId: selection.studentId })`; `GENERIC_SUBJECTS` is deleted.
  - Kept imports: `demoFixturesEnabled`, `demoInsights`, `InsightRole`, and the Fabric demo widgets.
- **Clock in tests.** The seeded attendance uses fixed dates, 2026-08-08 to 2026-10-28 (`scripts/seed/sections/attendance.ts`). Trend and timetable db tests sign in first, then fake only `Date` (`vi.useFakeTimers({ toFake: ["Date"] })`, the M07 precedent). HTTP and e2e tests never fake the clock and assert presence only, not data. The demo's 30-day and 42-day trends go empty from about 2026-11-28 (debt row; the seed fix is out of scope).
- **Honesty.** The staff-today counts include self check-ins. The widget's `description` says "Self check-ins are self-reported"; the check-in UI itself carries M08's `<LimitedBadge>`. No other badge changes.

Routing: T1 haiku none [] ; T2 haiku tests [3] ; T3 sonnet exclusive [] ; T4 sonnet tests [1,2,3] ; T5 sonnet tests [2] ; T6 sonnet tests [3] ; T7 sonnet tests [4,5] ; T8 sonnet tests [2] ; T9 sonnet tests [1,4,6] ; T10 sonnet tests [4,5] ; T11 sonnet tests [6,10] ; T12 sonnet tests [4,6,11] ; T13 haiku none [10,11,12] ; T14 sonnet tests [7,8,9,13] ; T15 haiku none [14]

Every new query gets a def in `src/modules/core/query-defs.ts` and a smoke sample in `tests/db/api-query-route.test.ts`. `all-queries.ts` already imports core, so it needs no new line. T4, T5, T7, T8 and T9 all edit `core/query-defs.ts` and the smoke map: re-read both right before editing. Seeded-tenant db tests use T2's helper and never write to the demo tenant; module toggles are in-memory copies of `ctx.institution.settings`. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`). E2E runs `pnpm test:e2e e2e/<file>.spec.ts` against `pnpm dev` with the seeded tenant. The e2e tasks (T10 → T11 → T12 → T14) are chained, so two never run at once.

---

### Task 1: M16-T1 Dashboard Zod schemas (Haiku)
READ: BRIEF-COMMON.md; rulings (trend, role dashboards); `src/modules/timetable/schemas.ts` (style)
FILES: `src/modules/core/dashboard.schemas.ts` (new; zod only, relative imports); `tests/unit/dashboard-schemas.test.ts` (new)
EXPORTS (all `.strict()`): `AttendanceTrendSchema` {days: int 7–92 default 30, classSectionId?: uuid, studentId?: uuid} (refine: not both scopes); `PortalDashboardSchema` {studentId: uuid}; inferred `AttendanceTrendInput`, `PortalDashboardInput`.
TEST FIRST: `{}` parses to days 30; days 6 and 93 are rejected; both scopes together are rejected; a non-uuid studentId is rejected; an unknown key is rejected.
ACCEPT: `pnpm test tests/unit/dashboard-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M16-T2 Seeded-tenant test helper (Haiku)
READ: BRIEF-COMMON.md; `tests/db/dashboard-queries.test.ts` lines 1–110
FILES: `tests/helpers/demo-context.ts` (new); `tests/db/dashboard-queries.test.ts` (import the helpers instead of the local copies; assertions unchanged)
EXPORTS:
- Moved as they are: `signInDemo(loginKey, retry?)`, `buildDemoContext(loginKey, role)` → `{ ctx, client }`, `timed(fn)` → `{ result, ms }`. `buildDemoContext` resolves `st-josephs-demo` itself and throws "run `pnpm db:reset` first" when it is missing.
- New: `withModules(ctx, overrides: Record<string, boolean>): TenantContext`. It returns a copy with `settings.modules` merged and writes nothing to the DB.
- New: `closeDemoHelper()` ends the helper's postgres pool.
TEST FIRST: none new. This is a refactor; the moved file must stay green with unchanged assertions.
ACCEPT: `pnpm test:db tests/db/dashboard-queries.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M16-T3 Migration 0078 — `attendance_daily_counts` (Sonnet, DB owner)
READ: BRIEF-COMMON.md; rulings (0078); `supabase/migrations/20261028000006_attendance.sql` + `…0020_rls_performance.sql` (records/sessions RLS); `…0069_timetable.sql` (grant block); `…0070_staffing.sql` (`period_id`)
FILES: `supabase/migrations/20261028000078_dashboard_attendance_counts.sql`; `tests/db/attendance-daily-counts.test.ts`; `src/lib/db/types.ts` (regen)
EXPORTS: the function, exactly as in the rulings.
TEST FIRST (fixture institutions, real role clients):
- The principal gets counts for both sections over 3 dates.
- With `p_by_section`, rows are per section; without it, `class_section_id` is null.
- A period session's records are excluded.
- The class teacher of section A sees only A's counts.
- A guardian sees only their own child's counts.
- `p_student_id` of another family's child → 0 rows. Another institution's id → 0 rows.
- `p_to - p_from = 92` → `validation_failed`; 91 is accepted.
- anon cannot execute the function.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/attendance-daily-counts.test.ts`; `pnpm test:security` (if a grants audit lists the new function, update its expectation and say so); `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M16-T4 Attendance aggregate reads + `dashboard.attendanceTrend`
READ: BRIEF-COMMON.md; rulings (0078, trend, clock); T3 function; `src/modules/attendance/queries.ts` (`computeAttendancePercentage`, `attendanceTodaySummary`, `sectionsBelowThreshold`, `todayInInstitutionTimezone`)
FILES: `src/modules/attendance/queries.ts`; `src/modules/core/query-defs.ts`; `tests/db/attendance-trend.test.ts`; + smoke sample
EXPORTS:
- `attendanceDailyCounts(ctx, { from, to, classSectionId?, studentId?, bySection? }): Promise<{ date: string; classSectionId: string | null; status: string; n: number }[]>` (RPC call).
- `percentageFromCounts(rows: { status: string; n: number }[], statuses)`, with the same output as `computeAttendancePercentage`; that function now delegates to it.
- `TrendPoint`; `attendanceTrend(ctx, { days, classSectionId?, studentId? }): Promise<TrendPoint[]>`, per the rulings.
- `attendanceTodaySummary` and `sectionsBelowThreshold` keep their signatures and return types but read through `attendanceDailyCounts` for one day. `sectionsBelowThreshold` uses `bySection`, then one `class_sections` + `grades(code)` read for the labels.
- Def `dashboard.attendanceTrend` (`AttendanceTrendSchema`, `attendance.read`, `module: "core"`).
TEST FIRST (seeded tenant via the T2 helper, `Date` faked to 2026-10-28 12:00 IST):
- For 2026-10-28, the principal's `attendanceDailyCounts` sums to the postgres `count(*)` for that date. That count is over 1000, which proves no `max_rows` truncation.
- `attendanceTodaySummary` equals the SQL-computed weighted %.
- `attendanceTrend({ days: 30 })` is ascending, each value 0–100, one point per seeded school day in the window, labels like "28 Oct".
- teacher.vi-a with no scope gets the same result as `classSectionId` = VI-A.
- guardian.one with their own child's `studentId` gets running %, and the last point equals that child's window % from SQL. With another family's student → `[]`.
- `tests/db/dashboard-queries.test.ts` stays green.
ACCEPT: `pnpm test:db tests/db/attendance-trend.test.ts tests/db/dashboard-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoAttendanceTrend` (`{ label, value }[]`)

### Task 5: M16-T5 `core.approvals.pending`
READ: BRIEF-COMMON.md; rulings (approvals table); `ApprovalRow` in `src/components/widgets/approvals-widget.tsx`; M08 `src/modules/people/hr.queries.ts` (the function behind `people.pendingLeaveApprovals` and its age format; reuse the formatter if it is exported); `listRecheckQueue` in `src/modules/exams/queries.ts`; MOD `isModuleEnabled`
FILES: `src/modules/core/approvals.queries.ts` (new); `src/modules/core/query-defs.ts`; `tests/db/approvals-pending.test.ts`; + smoke sample
EXPORTS: `pendingApprovals(ctx): Promise<ApprovalRow[]>`; def `core.approvals.pending` (`{}` strict, `dashboard.view`, `module: "core"`).
TEST FIRST (seeded tenant, T2 helper):
- The principal gets the seeded pending leave rows first: kind `leave`, a title like "Casual leave, 2 days", no href.
- Then come the recheck rows. Their count equals the SQL count of `recheck_requests` in `submitted|under_review`. Each has href `/st-josephs-demo/exams/rechecks` and no reason text.
- exam_controller gets recheck rows only. accountant gets `[]`.
- `withModules(ctx, { staff_attendance: false })` drops the leave rows; `{ exams: false }` drops the recheck rows.
- Every `age` matches `/^\d+ (h|d)$/`.
ACCEPT: `pnpm test:db tests/db/approvals-pending.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoApprovals` (`ApprovalRow[]`)

### Task 6: M16-T6 `timetable.todayFor` — selected student + teacher subtitle
READ: BRIEF-COMMON.md; rulings (page swaps); `src/modules/timetable/queries.ts` (`timetableTodayFor`, `firstOwnSectionId`, `timetableForStudent`, `fetchSlots`); `tests/db/timetable-queries.test.ts` (the mocked-clock todayFor case)
FILES: `src/modules/timetable/queries.ts`; `src/modules/timetable/query-defs.ts` (inline schema `{ studentId?: uuid }` strict; `schemas.ts` untouched); `tests/db/timetable-queries.test.ts` (add cases)
EXPORTS: `timetableTodayFor(ctx, studentId?: string)`.
- With `studentId`, the grid is that student's active-enrolment section. RLS decides; for a student the caller cannot see, it returns the bell schedule only, with no subjects.
- Without `studentId`, behaviour is unchanged.
- A teacher's own rows get `subtitle` = the slot's section name; today it is the teacher's own name. Other roles keep the teacher name.
TEST FIRST:
- Guardian with two children, `studentId` = the second child → the second child's subjects.
- Another family's child → periods are present, but every non-break `title` is the period name and there is no `subtitle`.
- A teacher's rows show the section, not their own name.
- `{}` input behaves as before.
ACCEPT: `pnpm test:db tests/db/timetable-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoTimetable` (`TimetablePeriod[]`) — completes M07's replacement for the portal's selected child

### Task 7: M16-T7 `dashboard.principal` + `dashboard.operations`
READ: BRIEF-COMMON.md; rulings (role dashboards); `src/modules/core/dashboard.queries.ts`; T4/T5 exports; M08 `people/hr.queries.ts` (`staffAvailabilityToday`) + `timetable/substitution.queries.ts` (coverNeeded); M13 `facilities/queries.ts` (maintenanceRequests) + `calendar/queries.ts` (forRole)
FILES: `src/modules/core/dashboard-leader.queries.ts` (new); `src/modules/core/query-defs.ts`; `tests/db/dashboard-leader.test.ts`; + smoke samples
EXPORTS: `PrincipalDashboard`, `principalDashboard(ctx)`; `OperationsDashboard`, `operationsDashboard(ctx)`; defs `dashboard.principal` and `dashboard.operations` (`{}` strict, `dashboard.view`, `module: "core"`).
TEST FIRST (seeded tenant):
- principal → every `DashboardDTO` key, plus an `attendanceTrend` array, `approvals` equal to `pendingApprovals`, and `staffToday` with numeric counts.
- accountant (has `dashboard.view` and `staff.read`, lacks `attendance.read`) → `attendanceTrend` null.
- `withModules({ staff_attendance: false })` → `staffToday` null.
- admin operations → four non-null fields; every `coverNeeded` row has `substitution: null`; at most 5 maintenance rows and 5 events.
- `{ facilities: false }` → `openMaintenance` null; `{ substitution: false }` → `coverNeeded` null.
- `getQueryMeta()` shows `dashboard.view` for both queries (teacher lacks it).
ACCEPT: `pnpm test:db tests/db/dashboard-leader.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoAttendanceTrend`, `demoApprovals`, `demoStaffAvailability` (API composite)

### Task 8: M16-T8 `dashboard.finance` + `dashboard.admissions`
READ: BRIEF-COMMON.md; rulings; `src/modules/core/dashboard.queries.ts` (`currentTermCollections`); `listDefaulters` (`finance/queries.ts`); `getAdmissionsFunnelCounts` + `listEnquiriesByStage` (`admissions/queries.ts`); the accountant/admissions branches of the dashboard page (current derivations)
FILES: `src/modules/core/dashboard-office.queries.ts` (new); `src/modules/core/query-defs.ts`; `tests/db/dashboard-office.test.ts`; + smoke samples; one-word `export` on `currentTermCollections` in `src/modules/core/dashboard.queries.ts`
EXPORTS: `FinanceDashboard`, `financeDashboard(ctx)`; `AdmissionsDashboard`, `admissionsDashboard(ctx)`; defs `dashboard.finance` and `dashboard.admissions` (`{}` strict, `dashboard.view`, `module: "core"`).
TEST FIRST (seeded tenant):
- accountant finance → `collections` with `collectedPaise ≤ duePaise`; `overdue` has at most 10 rows, sorted by outstanding descending, every `dueOn` before today.
- exam_controller → both finance fields null (no `finance.read`).
- admissions → `funnel` equals `getAdmissionsFunnelCounts`; `recentEnquiries` has at most 5 rows, newest first.
- `withModules({ admissions: false })` → both admissions fields null. accountant admissions → both null.
ACCEPT: `pnpm test:db tests/db/dashboard-office.test.ts tests/db/dashboard-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 9: M16-T9 `dashboard.teacher`, `dashboard.parent`, `dashboard.student`
READ: BRIEF-COMMON.md; rulings; `today/page.tsx` + `portal/page.tsx` (current reads); T4 `attendanceTrend`; T6 `timetableTodayFor`; `getStudentProfile` + `getCurrentTermId` (people); `getStudentAttendanceSummary` + `getTodaySectionsForTeacher` (attendance); `listInvoicesForStudent`; `listResultsForStudent`; `getMyPapers`; `listStudentAssignments`; `listTeacherAssignments`
FILES: `src/modules/core/dashboard-member.queries.ts` (new); `src/modules/core/query-defs.ts`; `tests/db/dashboard-member.test.ts`; + smoke samples
EXPORTS: `TeacherDashboard`, `teacherDashboard(ctx)`; `PortalDashboard`, `portalDashboard(ctx, studentId)`. Defs, all `module: "core"`: `dashboard.teacher` (`{}`, `attendance.mark`); `dashboard.parent` (`PortalDashboardSchema`, `student.read`); `dashboard.student` (`{}`, `student.read`; uses the caller's own `membership.studentId`, else `forbidden`).
TEST FIRST (seeded tenant; `Date` faked to Mon 2026-10-26 10:00 IST):
- teacher.vi-a → `timetable` non-empty with section subtitles; `sectionsToday` contains VI-A; the counts are numbers.
- `withModules({ timetable: false })` → `timetable` null.
- guardian.one, parent dashboard for their own child → all fields set; `outstandingFees` equals the SQL sum of that child's unpaid invoice balances.
- Parent dashboard for another family's child → `not_found`.
- student.one, student dashboard → their own `studentId`. principal calling `dashboard.student` → `forbidden`.
- `{ exams: false }` → `latestResult` null.
ACCEPT: `pnpm test:db tests/db/dashboard-member.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoTimetable`, `demoAttendanceTrend` (API composite)

### Task 10: M16-T10 `/dashboard` swap — trend, approvals, staff today
READ: BRIEF-COMMON.md; rulings (page swaps, honesty); `src/app/(tenant)/[institution]/dashboard/page.tsx` lines 140–160 and 455–545 (re-read first: MOD and M17-T4 also edit this file); `e2e/j13-dashboard.spec.ts`
FILES: `src/app/(tenant)/[institution]/dashboard/page.tsx`; `e2e/j13-dashboard.spec.ts`
EXPORTS: changes to the leader branch only.
- Add three entries to the `extrasP` `allSettled` list:
  - `isLeader && canAttendance ? attendanceTrend(ctx, { days: 42 }) : skip`
  - `isLeader ? pendingApprovals(ctx) : skip`
  - `isLeader && hasPermission(ctx, "staff.read") && isModuleEnabled(ctx, "staff_attendance") ? staffAvailabilityToday(ctx) : skip`

  Log each rejection like the others, and render `FailedWidget` for that card.
- Replace the `trend` helper: `sparkAtt` = the last 20 trend values; `bars` = the trend through the existing chunk code, when it has points.
- Delete `sparkEnq`, `sparkFee`, `sparkRes` and their `delta`/`spark` props. `deltaOf` returns `undefined` when `s[0] === 0`.
- Move the `approvals` and `staff` cards out of the `if (demo)` block. Add the staff card only when its value is non-null, with description "Self check-ins are self-reported".
- Drop the 3 fixture imports.
TEST FIRST: extend J-13:
- The "Pending approvals" card lists a row matching `/Casual leave/` (M08 seed) and does not show "No pending approvals".
- The "Staff today" card is visible.
- The "Attendance performance" card is visible.
ACCEPT: `pnpm test:e2e e2e/j13-dashboard.spec.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoAttendanceTrend`, `demoApprovals`, `demoStaffAvailability` (page)

### Task 11: M16-T11 `/today` swap — real timetable
READ: BRIEF-COMMON.md; rulings; `src/app/(tenant)/[institution]/today/page.tsx` (re-read first: MOD may edit it); `e2e/j06-attendance.spec.ts`
FILES: `src/app/(tenant)/[institution]/today/page.tsx`; `e2e/j06-attendance.spec.ts`
EXPORTS: `timetableTodayFor(ctx)` joins the page's `allSettled` list when `isModuleEnabled(ctx, "timetable")`. A rejection renders through the page's `settled()` ErrorState. Delete the `demoTimetable` block and its `papers`/`sections` entries mapping. The widget renders for every tenant.
TEST FIRST: extend J-06: teacher.vi-a's `/today` shows the "Today's timetable" widget. Monday–Saturday (IST) it is not "No periods today"; on Sunday it shows "No periods today".
ACCEPT: `pnpm test:e2e e2e/j06-attendance.spec.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoTimetable` (/today)

### Task 12: M16-T12 `/portal` swap — selected child's timetable + trend
READ: BRIEF-COMMON.md; rulings; `src/app/(tenant)/[institution]/portal/page.tsx` (re-read first); `e2e/j07-guardian-portal.spec.ts`
FILES: `src/app/(tenant)/[institution]/portal/page.tsx`; `e2e/j07-guardian-portal.spec.ts`
EXPORTS:
- `timetableTodayFor(ctx, selection.studentId)` (module `timetable`) and `attendanceTrend(ctx, { days: 30, studentId: selection.studentId })` replace the two fixtures.
- Both run via `Promise.allSettled`; a rejection renders the page's `Failed` widget.
- Delete `GENERIC_SUBJECTS` and its shortcut comment.
- The trend widget's description becomes "Running attendance %, school days".
TEST FIRST: extend J-07: guardian.one's portal shows "<first name>'s timetable today" (Monday–Saturday: not "No periods today") and the "Attendance, last 30 days" card.
ACCEPT: `pnpm test:e2e e2e/j07-guardian-portal.spec.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoTimetable`, `demoAttendanceTrend` (/portal)

### Task 13: M16-T13 Delete the four fixtures (Haiku)
READ: BRIEF-COMMON.md; `src/modules/core/demo/fixtures.ts`; `tests/unit/demo-fixtures.test.ts`
FILES: `src/modules/core/demo/fixtures.ts`; `tests/unit/demo-fixtures.test.ts`; `scripts/seed/sections/timetable.ts` (2 comments only)
EXPORTS:
- Delete `demoTimetable`, `demoAttendanceTrend`, `demoStaffAvailability` and `demoApprovals`.
- Also delete everything only they used: `rng`, `pick`, `TZ`, `ist`, `label`, `parts`, `hhmm`, `SLOTS`, `STAFF`, `APPROVALS`, `ageLabel`, and the 3 widget type imports.
- Keep `demoFixturesEnabled`, `InsightRole`, `InsightFacts`, `demoInsights` and the header comment.
- Delete the test blocks for the removed functions; keep the `demoInsights` tests.
- The two seed comments that cite `fixtures.ts` `SLOTS` state the times inline instead: 08:00–14:10 IST, 45-min periods, 15-min break, 40-min lunch.
TEST FIRST: n/a (deletion). Gate: `grep -rnE "demo(Timetable|AttendanceTrend|Approvals|StaffAvailability)\(" src tests e2e scripts` → empty.
ACCEPT: the gate; `pnpm test tests/unit/demo-fixtures.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: deletes all four

### Task 14: M16-T14 Perf budget + acceptance
READ: BRIEF-COMMON.md; rulings (perf); `tests/db/api-query-route.test.ts` (in-process route + bearer pattern, `next/headers` mock); T2 helper
FILES: `tests/db/dashboard-perf.test.ts` (new)
EXPORTS: none (test only). The perf matrix is in the rulings.
TEST FIRST: every matrix entry returns 200 + `ok: true`, and the median of 3 timed calls (after 1 warm-up) is under 1500 ms. Log the medians.
ACCEPT: `pnpm test:db tests/db/dashboard-perf.test.ts`; then, with the fixtures gone (T13), `pnpm test:e2e e2e/j13-dashboard.spec.ts e2e/j06-attendance.spec.ts e2e/j07-guardian-portal.spec.ts`; `pnpm lint`; `pnpm typecheck`. The report includes the table of medians.
REPLACES FIXTURE: none

### Task 15: M16-T15 Docs (Haiku)
FILES (docs only, Edit only):
- `docs/planning/coolskool/10-backlog-index.md` §3: `0078` → "(M16, built)".
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4: one line under the table: "M16: no new definer; `public.attendance_daily_counts` (0078) is security invoker (RLS applies) and granted to authenticated only."
- `docs/planning/coolskool/03-feature-matrix.md`: F-INT-01 stays `impl`. Report "no change".
- `docs/planning/coolskool/12-decision-log.md` §3: add debt rows with the next free DBT numbers. Grep the highest number first, because parallel milestones add rows.
  - Seeded attendance uses fixed dates, 2026-08-08 to 2026-10-28. The demo's 30-day and 42-day trends and weekly bars go empty from about 2026-11-28 and 2026-12-09. Upgrade: end the attendance seed window on the run date's previous school day.
  - `core.approvals.pending` is grouped by source (leave, then recheck), not globally oldest first, because `ApprovalRow` has no timestamp. Upgrade with M19's `insight` source: add `requestedAt`.
  - The dashboard KPI sparklines for enquiries, fees and results were removed (they were attendance fixtures). No real series exists yet. Upgrade in Workstream D.
  - Pages call the module functions, not the `dashboard.*` role queries, and `dashboard.operations` has no page. Workstream D switches the pages.
  - The `insight` (M19) and `agent_run` (M22) approval sources are not in the union yet. Each of those milestones adds its branch (M16 rulings table).
ACCEPT: the tables render (no broken pipes); `pnpm lint`
REPLACES FIXTURE: none

---

Controller after T15: run a security review (Sonnet) on the M16 diff, covering the invoker aggregate under RLS, BOLA on `dashboard.parent`, per-field permission/module gates, and no PII in approval rows. Fix CRIT/HIGH/MED. Run the full gate. Check `pnpm db:reset` + seed run clean and e2e j13/j06/j07 are green. Commit and push. The hosted push of 0078 is owner-run. Post `DONE M16 <sha>`.
