# M08 — Period attendance, staff attendance, leave, substitution

Source: `07-master-plan-v1-v2.md` §3 M8. Migration `0070` (claimed; one file `supabase/migrations/20261028000070_staffing.sql`, written by T2 → T3 → T4 in that order, each appending one part). No new deps. Owning modules: `people` owns `staff_attendance`, `leave_requests` (F-HR-01 lists `people`); `timetable` owns `substitutions`; `attendance` owns `attendance_sessions.period_id` + period marking. Replaces fixtures `demoStaffAvailability` (`StaffAvailability`, `src/components/widgets/staff-availability-widget.tsx`), the leave part of `demoApprovals` (`ApprovalRow`, `src/components/widgets/approvals-widget.tsx`), and fills `TeacherWorkload.leave_dates` (`src/modules/fabric/types.ts`; `[]` since M07).

Rulings:
- **Helper.** `app.my_staff_ids()` returns `setof uuid` = `memberships.staff_id` of the caller's active memberships (staff_id not null). Mirror `app.my_class_teacher_section_ids` in 0026 exactly (sql, stable, definer, `search_path=''`, revoke public, grant authenticated). Use it only as `col = any((select app.my_staff_ids()))` (lesson 7).
- **`staff_attendance`** columns: id; institution_id; staff_id → staff not null; date not null; status `present|absent|late|half_day`; source `admin|self` default `admin`; check_in_at timestamptz null; note ≤ 200 null; marked_by → profiles null; created_at/updated_at + `set_updated_at`. Unique `(staff_id, date)`; index `(institution_id, date)`. "On leave" is never a stored status: it is derived from approved `leave_requests`.
  RLS SELECT: `institution_id = any((select app.my_institution_ids(array['owner','principal','admin'])))` or `staff_id = any((select app.my_staff_ids()))`. INSERT/UPDATE: `app.has_role(institution_id, owner/principal/admin)` and `app.staff_in_institution(staff_id, institution_id)` and `source = 'admin'`. No DELETE policy.
  `public.staff_check_in(p_institution_id uuid) returns public.staff_attendance` (definer wrapper over `app.*`): the caller's `app.staff_id(inst)` (null → `code:forbidden`). Today = `(now() at time zone coalesce(settings->'locale'->>'timezone','Asia/Kolkata'))::date`. Approved leave covering today → `code:invalid_state`. Inserts `(present, self, check_in_at now(), marked_by caller)` `on conflict (staff_id, date) do nothing`, then returns that day's row. A row an admin already marked is returned unchanged (idempotent). No audit: the row records source and marked_by.
- **`leave_requests`** columns: id; institution_id; staff_id → staff not null; leave_type `casual|sick|earned|unpaid|other`; start_date, end_date (check `end_date >= start_date and end_date - start_date <= 30`); reason 1–500 not null; status `pending|approved|rejected|cancelled` default `pending`; created_by → profiles not null; decided_by → profiles null; decided_at null; decision_note ≤ 500 null; created_at/updated_at. Indexes `(institution_id, status)`, `(staff_id, start_date)`.
  RLS SELECT: owner/principal/admin all of the institution (initPlan form), or own (`staff_id = any((select app.my_staff_ids()))`). INSERT: (`app.has_role(inst, owner/principal/admin)` or own staff_id) and `app.staff_in_institution(staff_id, institution_id)`. No UPDATE or DELETE policy: decisions go through the RPC only.
  Guard trigger `app.guard_leave_requests` (BEFORE INSERT OR UPDATE). Bypass only per lesson 5. On INSERT it forces `status='pending'`, nulls `decided_*`, and sets `created_by := app.current_user_id()`. An overlapping `pending|approved` row for the same staff (`daterange(start,end,'[]') &&`) raises `code:conflict`. On UPDATE: GUC `app.allow_leave_decision` must be `on`, else `code:forbidden`; identity columns (institution_id, staff_id, leave_type, dates, reason, created_by) are immutable (`code:invalid_state`).
  `public.decide_leave(p_leave_id uuid, p_decision text, p_note text default null) returns public.leave_requests`. The state machine is: `pending→approved|rejected` (owner/principal/admin of the leave's institution, never own: `leave.staff_id = app.staff_id(inst)` → `code:forbidden`); `pending→cancelled` (requester or approver roles); `approved→cancelled` (approver roles, not own). Any other transition → `code:invalid_state`. A bad decision value → `code:validation_failed`. It sets decided_by/at/note under the GUC and audits `leave.approved|leave.rejected|leave.cancelled` with `{status}` before and after only. Never put the reason or note in audit, errors or logs (lesson 10).
- **`substitutions`** columns: id; institution_id; slot_id → timetable_slots not null; date not null; period_id → periods not null and original_teacher_id → staff not null (both copied from the slot by the RPC); substitute_teacher_id → staff not null; leave_request_id → leave_requests null; status `assigned|cancelled` default `assigned`; note ≤ 200 null; created_by → profiles; cancelled_at null; created_at/updated_at. Check `substitute_teacher_id <> original_teacher_id`. Partial uniques `where status='assigned'`: `substitutions_slot_date_idx (slot_id, date)` and `substitutions_substitute_period_idx (substitute_teacher_id, date, period_id)`. These are the double-booking backstop.
  RLS SELECT: owner/principal/admin all; `substitute_teacher_id = any((select app.my_staff_ids()))` or `original_teacher_id = any((select app.my_staff_ids()))`. No write policies: writes are RPC-only (lesson 3).
  `public.assign_substitution(p_slot_id uuid, p_date date, p_substitute_id uuid, p_leave_request_id uuid default null, p_note text default null) returns public.substitutions` checks, in order:
  1. Auth.
  2. The slot exists (else `not_found`).
  3. The caller has owner/principal/admin in the slot's institution (else `forbidden`).
  4. The slot's version is `published` (else `invalid_state`).
  5. `extract(isodow from p_date) = slot.weekday` and `p_date >= today(tz)` (else `validation_failed`).
  6. The substitute is active staff of the same institution and is not the slot teacher (else `validation_failed`).
  7. The substitute is not on approved leave covering p_date (else `conflict`).
  8. The substitute has no slot at (weekday, period) in the same version (else `conflict`).
  9. The substitute has no assigned substitution at (date, period) (else `conflict`).
  10. The slot has no assigned substitution for the date (else `conflict`).
  11. If `p_leave_request_id` is given, it is the same institution, belongs to the slot teacher, is approved and covers the date (else `validation_failed`).

  It then inserts and audits `substitution.assigned` (ids only). `public.cancel_substitution(p_substitution_id uuid)`: approver roles only; `assigned→cancelled` (sets cancelled_at) else `invalid_state`; audits `substitution.cancelled`. Future-dated substitutions do not move when a new timetable version is published (debt row).
- **Period attendance.** `attendance_sessions.period_id uuid null → periods`. Drop `attendance_sessions_class_section_id_date_key` and add `constraint attendance_sessions_section_date_period_key unique nulls not distinct (class_section_id, date, period_id)` (PG 17). Daily stays `period_id is null` (the default).
  Guard trigger `app.guard_attendance_sessions_period` (BEFORE INSERT OR UPDATE, lesson 5 bypass). An INSERT with a non-null period_id, or any UPDATE of a row whose old or new period_id is non-null, requires GUC `app.allow_period_attendance='on'`, else `code:forbidden`. Only the RPC sets the GUC.
  `public.mark_period_attendance(p_institution_id uuid, p_class_section_id uuid, p_period_id uuid, p_date date, p_records jsonb) returns public.attendance_sessions`. p_records is `[{student_id, status, note?}]` with 1–200 entries (else `validation_failed`). Steps:
  1. Resolve the slot: the published version of the institution, the section, `weekday = isodow(p_date)`, the period (else `not_found`).
  2. Date: not future in tz (`validation_failed`); non-admin at most 7 days back (`forbidden`).
  3. Who may mark: owner/principal/admin; the assigned substitute for (slot, date); or, only when no substitution is assigned, `slot.teacher_id = app.staff_id(inst)`. Anyone else → `forbidden`.
  4. Every student must be actively enrolled in the section (`validation_failed`). Status codes are checked by the existing records trigger.
  5. An existing session for (section, date, period) → `invalid_state` ("already marked; use attendance.correct").
  6. Write order: insert the session `open` with `marked_by = app.staff_id`, insert the records, then set `submitted`/`submitted_at`, all under the GUC. This mirrors `submit_attendance` and avoids open-only record rules.
  7. No `notify.attendance_absence` jobs: the daily register stays the only guardian-notification source.
  8. Audit `attendance.period_marked` with ids and counts.

  Corrections of period records use the existing `attendance.correct` unchanged.
  **Every daily reader filters `period_id is null`**: `create or replace app.term_attendance_percentage` (0009); `attendance.mark` lookup + `onConflict: "class_section_id,date,period_id"`; every `attendance/queries.ts` read of sessions/records (`.is("period_id", null)` / `.is("attendance_sessions.period_id", null)`); `scripts/load/l1-attendance-burst.ts` onConflict. Otherwise `.maybeSingle()` on (section, date) breaks and daily % is skewed.
- **Permissions** (07 §2.2 rows, column order own pri adm ads acc exc tch stu grd):
  - `staff.attendance.mark` = ✓ ✓ ✓ s s s s · · (s = self check-in only).
  - `leave.request` = ✓ ✓ ✓ s s s s · · (s = own leave).
  - `leave.approve` = ✓ ✓ ✓ · · · · · · (never own).

  Substitution actions/queries reuse `timetable.manage` / `timetable.read`. Handlers enforce `s`: `people.staffAttendance.mark` requires owner/principal/admin (`forbidden` otherwise). `people.leave.request` with another staff's `staffId` requires owner/principal/admin. A caller without `ctx.membership.staffId` gets `forbidden` ("no staff record") for check-in and own leave.
- **ErrorCode mapping** in actions: RPC `code:*` via `mapSqlError`. `42501` → `forbidden`. `23505` on `substitutions_*_idx` → `conflict` (`fieldErrors.substituteId`); on `attendance_sessions_section_date_period_key` → `invalid_state`; on `staff_attendance (staff_id,date)` it is an upsert, so it cannot occur. Marking a staff member who has approved leave that date → `invalid_state` with `fieldErrors.records: ["<index>: on approved leave"]`.
- **Audit.** Exactly once per mutation: RPC-backed actions do not audit again in TS. `people.staffAttendance.mark` audits `staff_attendance.marked` with `{date, count}`. `people.leave.request` audits `leave.requested` (id only).
- **Queries.** "Today" = institution tz via `todayInInstitutionTimezone` from `src/modules/attendance/queries.ts` (T11 adds `export`; nothing else changes there). Cross-module reads of leave/staff attendance go through the `people` helpers `staffUnavailableOn` and `approvedLeaveDates` (T11).
- **Honesty.** No UI this milestone. When UI lands, self check-in shows `<LimitedBadge>` "self-reported, no biometric/geofence". Leave decisions and substitutions send no notifications (debt). F-ATT-04 biometric/RFID stays planned.

Routing (owner: Haiku mechanical, Sonnet rest, no Opus): T1, T5, T6, T15 Haiku; T2–T4, T7–T14 Sonnet. Parallel: {T1 ‖ T2 ‖ T5 ‖ T6} → T3 → T4. T7 ‖ T8 ‖ T11 after T2 (+T1, T5). T9 after T3 + T6. T10 after T4 + T6. T12 after T11 + T3. T13 after T4. T14 after T7–T12. T15 last. Migration tasks are the DB owner, one at a time. The others run only their own db files.

Every new action: `all-actions.ts` import + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `query-defs` + `all-queries.ts` + smoke sample in `tests/db/api-query-route.test.ts`. Re-read shared registries right before editing; parallel tasks touch them. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`).

---

### Task 1: M08-T1 Permissions `staff.attendance.mark`, `leave.request`, `leave.approve` (Haiku)
READ: BRIEF-COMMON.md; rulings (Permissions)
FILES: `src/lib/auth/permissions.ts` (union + `ROLE_PERMISSIONS`); `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (3 rows after `timetable.read`, with the `s` notes); `tests/unit/permissions.test.ts` (3 rows)
TEST FIRST: the 3 matrix rows in `permissions.test.ts` (s cells = true)
ACCEPT: `pnpm test tests/unit/permissions.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M08-T2 Migration 0070 part 1 — `my_staff_ids`, `staff_attendance`, `leave_requests`, check-in + decide RPCs
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000069_timetable.sql` (guard + GUC + definer/wrapper + grants pattern); `…0026_assignments_write_scope.sql` (helper); `…0014_attendance_submit.sql` (timezone today); `tests/db/timetable-rls.test.ts` (fixture style)
FILES: `supabase/migrations/20261028000070_staffing.sql` (new, header comment names all 3 parts); `tests/db/staff-leave-rls.test.ts`; `src/lib/db/types.ts` (regen); `tests/security/rls-expectations.ts` (2 entries, timetable-style comment: own-row scoping proved in the db test)
EXPORTS: per rulings: helper, 2 tables, guard, `public.staff_check_in`, `public.decide_leave` (`app.*` impl revoked from everyone; `public.*` wrapper granted to authenticated only)
TEST FIRST: teacher inserts own leave → pending, created_by = self even if spoofed; teacher inserts leave for another staff → 42501; overlapping pending → conflict; principal approves teacher's leave → approved + `audit_events` row `leave.approved` without the reason; principal approves own leave → forbidden; teacher calls decide approve → forbidden; approve an approved one → invalid_state; requester cancels pending → cancelled; direct UPDATE of status → denied; admin marks staff_attendance for own-institution staff, not institution B's (lesson 2); teacher sees only own staff_attendance + leave rows, accountant and guardian see none of them; `staff_check_in` twice → same row; check-in on approved leave → invalid_state; student check-in → forbidden.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/staff-leave-rls.test.ts`; `pnpm test:security` (update expectations if needed, say so); `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M08-T3 Migration 0070 part 2 — `substitutions`, assign/cancel RPCs
READ: BRIEF-COMMON.md; rulings (substitutions); 0070 part 1; 0069 (slots, versions, `staff_in_institution`)
FILES: `supabase/migrations/20261028000070_staffing.sql` (append); `tests/db/substitutions-rls.test.ts`; `src/lib/db/types.ts` (regen); `tests/security/rls-expectations.ts` (1 entry)
EXPORTS: table + 2 partial unique indexes + RLS; `public.assign_substitution`, `public.cancel_substitution`
TEST FIRST: admin assigns a free teacher to a published slot on the matching weekday → assigned with period/original copied; the substitute teaches at that period → conflict; same substitute on two slots same date+period → conflict; second substitution for the same slot+date → conflict; substitute on approved leave → conflict; weekday mismatch → validation_failed; draft-version slot → invalid_state; teacher calls assign → forbidden; admin of B with A's slot → not_found/forbidden; substitute and original teacher see the row, an unrelated teacher and a guardian do not; cancel → cancelled, then re-assign succeeds.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/substitutions-rls.test.ts tests/db/staff-leave-rls.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M08-T4 Migration 0070 part 3 — period attendance + daily-reader compat
READ: BRIEF-COMMON.md; rulings (Period attendance); `…0006_attendance.sql`, `…0014_attendance_submit.sql`, `…0009_exams.sql` (`app.term_attendance_percentage`); `src/modules/attendance/actions.ts` (`markAttendance`), `queries.ts` (session/record reads)
FILES: `supabase/migrations/20261028000070_staffing.sql` (append); `tests/db/period-attendance-rls.test.ts`; `src/lib/db/types.ts` (regen). Compat edits are mandatory in the same task (the unique swap breaks them otherwise), ≤ 10 lines total: `src/modules/attendance/actions.ts`, `src/modules/attendance/queries.ts`, `scripts/load/l1-attendance-burst.ts`
EXPORTS: column, unique swap, guard, `public.mark_period_attendance`, `app.term_attendance_percentage` (create or replace, daily only)
TEST FIRST: a daily session and a period session coexist for the same section+date; direct insert with period_id → rejected; the slot teacher marks via RPC → submitted session with period_id and records; another teacher → forbidden; with a substitution assigned the substitute can mark and the original teacher cannot; a weekday/period with no published slot → not_found; future date → validation_failed; second mark → invalid_state; no `notify.attendance_absence` job enqueued; `app.term_attendance_percentage` (test SQL client) ignores period records.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/period-attendance-rls.test.ts tests/db/attendance-actions.test.ts tests/db/attendance-pattern-paging.test.ts tests/db/teacher-agent-attendance-scope.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M08-T5 HR Zod schemas (Haiku)
READ: BRIEF-COMMON.md; `src/modules/timetable/schemas.ts` (style, relative `.ts` imports); `src/lib/schemas/common.ts`
FILES: `src/modules/people/hr.schemas.ts` (new); `tests/unit/hr-schemas.test.ts`
EXPORTS (all `.strict()`): `StaffAttendanceMarkSchema` {date isoDate, records: {staffId uuid, status enum present|absent|late|half_day, note? ≤200}[] 1–300}; `CheckInSchema` {}; `LeaveRequestSchema` {staffId? uuid, leaveType enum, startDate, endDate, reason 1–500} (refine end ≥ start and ≤ 31 days inclusive); `LeaveDecisionSchema` {leaveId uuid, note? ≤500}; `LeaveCancelSchema` {leaveId}; `LeaveListSchema` {status? enum, staffId?, from? isoDate, to? isoDate, limit? int 1–200}; `StaffAttendanceForDateSchema` {date? isoDate}; plus inferred `*Input` types.
TEST FIRST: valid inputs parse; status `on_leave` rejected; endDate before startDate rejected; a 32-day leave rejected; 301 records rejected; unknown key rejected.
ACCEPT: `pnpm test tests/unit/hr-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M08-T6 Substitution + period-attendance Zod schemas (Haiku)
READ: BRIEF-COMMON.md; `src/modules/timetable/schemas.ts`; `src/modules/attendance/schemas.ts`
FILES: `src/modules/timetable/schemas.ts` (append); `src/modules/attendance/schemas.ts` (append); `tests/unit/m08-schemas.test.ts`
EXPORTS (all `.strict()`): timetable: `SubstitutionAssignSchema` {slotId, date isoDate, substituteId, leaveRequestId?, note? ≤200}; `SubstitutionCancelSchema` {substitutionId}; `SubstitutionCandidatesSchema` {slotId, date}; `CoverNeededSchema` {date?}; `SubstitutionsSchema` {date?}. attendance: `MarkPeriodAttendanceSchema` {classSectionId, periodId, date, records (same record object as `MarkAttendanceSchema`) 1–200}; `PeriodSummarySchema` {classSectionId, date}; plus inferred `*Input` types.
TEST FIRST: valid inputs parse; a bad date rejected; 201 records rejected; note of 201 chars rejected; unknown key rejected.
ACCEPT: `pnpm test tests/unit/m08-schemas.test.ts tests/unit/timetable-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M08-T7 Staff attendance actions
READ: BRIEF-COMMON.md; rulings; T2 SQL; T5 schemas; `src/modules/timetable/actions.ts` (style, error mapping)
FILES: `src/modules/people/staff-attendance.actions.ts` (new, `"use server"`); `tests/db/staff-attendance-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (permission `staff.attendance.mark`): `people.staffAttendance.mark` (owner/principal/admin only; upsert on `staff_id,date` with source `admin`, marked_by; rejects staff on approved leave that date; date not future in tz); `people.staffAttendance.checkIn` → `staff_check_in` RPC.
TEST FIRST: principal marks 3 staff → rows; re-mark updates status; teacher calls mark → forbidden; staff on approved leave → invalid_state naming the index; teacher checkIn twice → one row; guardian → forbidden.
ACCEPT: `pnpm test:db tests/db/staff-attendance-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: M08-T8 Leave actions
READ: BRIEF-COMMON.md; rulings; T2 SQL; T5 schemas; `src/modules/timetable/actions.ts`
FILES: `src/modules/people/leave.actions.ts` (new, `"use server"`); `tests/db/leave-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS: `people.leave.request` (`leave.request`; staffId defaults to `ctx.membership.staffId`; insert via RLS client; conflict mapped); `people.leave.approve` / `people.leave.reject` (`leave.approve`) → `decide_leave`; `people.leave.cancel` (`leave.request`) → `decide_leave(…,'cancelled')`.
TEST FIRST: teacher requests → pending; overlapping request → conflict; principal approves → approved and audited; principal approves own leave → forbidden; teacher approve → forbidden; teacher requests for another staff → forbidden; reject then approve → invalid_state; requester cancels pending → cancelled.
ACCEPT: `pnpm test:db tests/db/leave-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 9: M08-T9 Substitution actions
READ: BRIEF-COMMON.md; rulings; T3 SQL; T6 schemas; `src/modules/timetable/actions.ts` (23505 mapping by constraint name)
FILES: `src/modules/timetable/substitution.actions.ts` (new, `"use server"`); `tests/db/substitution-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (`timetable.manage`): `timetable.substitution.assign` → `assign_substitution` (23505 → conflict, `fieldErrors.substituteId`); `timetable.substitution.cancel` → `cancel_substitution`.
TEST FIRST: admin assigns a free teacher → ok; double-booked substitute → conflict naming substituteId; teacher → forbidden; cancel then cancel again → invalid_state.
ACCEPT: `pnpm test:db tests/db/substitution-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 10: M08-T10 Period attendance action + summary query
READ: BRIEF-COMMON.md; rulings; T4 SQL; T6 schemas; `src/modules/attendance/actions.ts` (`attendanceStatusCodes`), `query-defs.ts`
FILES: `src/modules/attendance/actions.ts` (add `markPeriodAttendance`); `src/modules/attendance/queries.ts` + `query-defs.ts` (add `periodSummary`); `tests/db/period-attendance-actions.test.ts`; + manifest unchanged (same file) + C-03 fixture + query smoke sample + `all-queries.ts` unchanged (same file)
EXPORTS: action `attendance.markPeriod` (`attendance.mark`; validates status codes against settings like `attendance.mark`, then RPC; returns `{sessionId, recordCount}`); query `attendance.periodSummary` (`attendance.read`) → `{ periodId, seq, name, startsAt, endsAt, sessionId: string|null, counts: Record<string, number> }[]` for every non-break period of the institution (RLS decides the visible records).
TEST FIRST: slot teacher marks period 2 → ok, and periodSummary shows counts on period 2 only; a non-slot teacher → forbidden; unknown status code → validation_failed; daily `attendance.getSession` for the same section+date is unaffected.
ACCEPT: `pnpm test:db tests/db/period-attendance-actions.test.ts tests/db/api-query-route.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 11: M08-T11 HR queries (fixture replacements)
READ: BRIEF-COMMON.md; rulings; fixture types named in the header; `demoStaffAvailability`/`demoApprovals` in `src/modules/core/demo/fixtures.ts` (string formats); `src/modules/timetable/queries.ts` + `query-defs.ts` (pattern)
FILES: `src/modules/people/hr.queries.ts` (new); `src/modules/people/hr.query-defs.ts` (new); `tests/db/hr-queries.test.ts`; + `all-queries.ts` line + smoke samples; one-word `export` on `todayInInstitutionTimezone` in `src/modules/attendance/queries.ts`
EXPORTS:
- `people.staffAvailabilityToday` (`staff.read`) → `StaffAvailability`. `onLeave` = active staff with approved leave covering today. `present` = today's status present/late/half_day, not on leave. `absent` = marked `absent`, not on leave; unmarked staff are counted nowhere. `onLeaveStaff` = `{name: full_name, role: designation, until}`, where until is "Back tomorrow" when end_date = today, else `Back in ${d} days` (d = end_date − today + 1), ordered by end_date then name, max 10.
- `people.pendingLeaveApprovals` (`leave.approve`) → `ApprovalRow[]` `{id, kind: "leave", title: "<Type> leave, N day(s)", requestedBy: full_name, age}`, where age is `"<h> h"` under 24 h else `"<d> d"` from created_at. Oldest first, no href.
- `people.leaveRequests` (`leave.request`, `LeaveListSchema`) → `LeaveRequestRow[]` `{id, staffId, staffName, leaveType, startDate, endDate, days, reason, status, decidedAt, decisionNote, createdAt}` (RLS: approvers all, staff own).
- `people.staffAttendanceForDate` (`staff.attendance.mark`) → `{staffId, name, designation, status: string|null, source: string|null, checkInAt: string|null, onLeave: boolean}[]`. Admin roles get every active staff member; others get only their own row.
- Helpers (plain exports, no registration): `staffUnavailableOn(ctx, date): Promise<Map<string, "leave"|"absent">>`; `approvedLeaveDates(ctx, staffIds, fromIso, toIso): Promise<Map<string, string[]>>` (each covered date, ascending).
TEST FIRST: availability counts match seeded fixture rows (1 on leave until today → "Back tomorrow"); pending approvals title "Casual leave, 2 days"; a teacher's leaveRequests returns only own rows; staffAttendanceForDate for a teacher returns 1 row; accountant `pendingLeaveApprovals` → forbidden.
ACCEPT: `pnpm test:db tests/db/hr-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `demoStaffAvailability` (`StaffAvailability`); `demoApprovals` leave rows (`ApprovalRow`)

### Task 12: M08-T12 Substitution queries + workload leave dates
READ: BRIEF-COMMON.md; rulings; T3 SQL; T11 helpers; `src/modules/timetable/queries.ts` (`fetchSlots`, `defaultPublishedVersionId`, `timetableTeacherWorkload`); F-UI-05 substitution dialog (`docs/planning/fabric/04-ui-packets/F-UI-05.md` line 9)
FILES: `src/modules/timetable/substitution.queries.ts` (new); `src/modules/timetable/query-defs.ts` (3 defs); `src/modules/timetable/queries.ts` (`leave_dates` = `approvedLeaveDates` for today..today+13); `tests/db/substitution-queries.test.ts`; + smoke samples
EXPORTS (default date = today in tz, current published version):
- `timetable.coverNeeded` (`timetable.manage`) → `{slotId, date, period: {seq, name, startsAt, endsAt}, section, subject, teacher: {id, name}, reason: "leave"|"absent", substitution: {id, substituteId, substituteName}|null}[]`: published slots on the date's weekday whose teacher is unavailable.
- `timetable.substitutionCandidates` (`timetable.manage`) → `{staffId, name, periodsWeek, maxPeriods}[]`: active `is_teaching` staff, not the slot teacher, free at that weekday/period in the version, with no assigned substitution at (date, period) and not unavailable on the date. Sorted by periodsWeek ascending, then name.
- `timetable.substitutions` (`timetable.read`) → assigned substitutions on the date that RLS shows, as `{id, date, period, section, subject, originalTeacher, substituteTeacher, status}[]`.
TEST FIRST: a teacher on leave → their slots appear in coverNeeded with `substitution: null`, and after assign it is filled; candidates exclude a teacher busy at that period and one on leave; the substitute teacher's `timetable.substitutions` shows the row, while an unrelated teacher sees none; teacherWorkload `leave_dates` lists approved dates.
ACCEPT: `pnpm test:db tests/db/substitution-queries.test.ts tests/db/timetable-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `TeacherWorkload.leave_dates`

### Task 13: M08-T13 Seed section `staffing`
READ: BRIEF-COMMON.md; `scripts/seed/sections/timetable.ts` (PRNG/uuidV5/`insertBatch`), `scripts/seed/index.ts`; `tests/db/seed-timetable.test.ts`, `seed-determinism.test.ts`
FILES: `scripts/seed/sections/staffing.ts` (new, relative `.ts` imports); `scripts/seed/index.ts` (register after `timetable`); `tests/db/seed-staffing.test.ts` (+ the 3 tables in `seed-determinism.test.ts` if it enumerates tables)
EXPORTS: deterministic ids, dates relative to the run date. Let `d0` = today if Mon–Sat, else the next Monday.
- `staff_attendance`: last 5 school days through d0, every active staff, PRNG 92% present / 4% late / 4% absent; staff on leave that day are skipped.
- `leave_requests` (service role, explicit created_by/decided_by = principal's user):
  - 1 approved `sick` for teacher A covering d0..d0+1.
  - 1 approved `earned` for teacher B covering d0+7..d0+9.
  - 3 pending `casual` (future, 1–2 days) for teachers C–E, created 2–60 h ago.
  - 1 rejected.
- `substitutions`: one assigned row for teacher A's first published slot on d0, with the first free teacher by the T3 rules and `leave_request_id` = A's leave.
TEST FIRST: the demo tenant has an approved leave covering d0 with an assigned substitution; ≥ 3 pending; no substitute double-booked; staff_attendance rows exist for d0−1 (or the latest school day before it); reseed gives identical ids.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset` (you are the seed owner); `pnpm test:db tests/db/seed-staffing.test.ts tests/db/seed-determinism.test.ts tests/db/seed-timetable.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none (gives the T11 queries demo data)

### Task 14: M08-T14 Acceptance over HTTP
READ: BRIEF-COMMON.md; `tests/db/timetable-acceptance.test.ts` (pattern)
FILES: `tests/db/staffing-acceptance.test.ts`
TEST, all via `/api/v1/actions/*` and `/api/v1/query/*` on a fixture institution with a published timetable. Steps in order:
1. Principal runs `people.staffAttendance.mark`; teacher runs `checkIn` twice and gets 200 both times with one row.
2. Teacher runs `people.leave.request`; principal runs `people.leave.approve`, which returns 200 and an `audit_events` row `leave.approved` appears.
3. Teacher calls `people.leave.approve` → 403. Principal approves own leave → 403.
4. `people.staffAvailabilityToday` shows onLeave 1. `people.pendingLeaveApprovals` lists a second pending request.
5. `timetable.coverNeeded` lists the teacher's slots. Use `substitutionCandidates`[0] for `timetable.substitution.assign` → 200. The same substitute for a second slot at the same period → 409 `conflict`.
6. The substitute runs `attendance.markPeriod` → 200. The original teacher → 403.
7. Daily `attendance.mark` + `attendance.getSession` still work for the same section+date.
ACCEPT: `pnpm test:db tests/db/staffing-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 15: M08-T15 Docs (Haiku)
FILES:
- `docs/planning/coolskool/10-backlog-index.md` §3: `0070` → "(M8, built)" with a list of its tables and RPCs.
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4: one row "SQL `security definer` — staffing (M08, `20261028000070`)" covering `staff_check_in`, `decide_leave`, `assign_substitution`, `cancel_substitution`, `mark_period_attendance`, helper `app.my_staff_ids`, and the guards (leave state machine under `app.allow_leave_decision`, period sessions under `app.allow_period_attendance`). Copy the timetable row style.
- `docs/planning/fabric/03-roadmap-and-tracker.md`: FB-WS-04 stays `simulated` and FB-EDU-07 stays `planned` (the UI still reads fixtures until Workstream D). Change no status; report "no change" with the reason.
- `docs/planning/coolskool/12-decision-log.md` §3: debt rows DBT-47…50:
  - DBT-47: leave overlap is checked by a trigger, so it can race. Upgrade: a `btree_gist` exclusion constraint.
  - DBT-48: no notification on leave decision or substitution assignment (M16/M17 channels).
  - DBT-49: period attendance never notifies guardians and is excluded from daily and term %; no subject-wise attendance report; substitutes not teaching the section cannot read the session back via RLS.
  - DBT-50: future substitutions do not move to a newly published timetable version, and `timetable.todayFor` does not show cover periods.
ACCEPT: rows render as tables (no broken pipes); `pnpm lint`
REPLACES FIXTURE: none

---

Controller after T14: security review (Sonnet) on the M08 diff (auth, RLS, definers); fix CRIT/HIGH/MED; full gate; `pnpm db:reset` + seed clean; commit/push; hosted push owner-run; `DONE M08 <sha>`.
