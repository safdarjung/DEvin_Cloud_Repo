# X01 — Student leave requests + daily diary

Source: owner directive 2026-11-02 (extension milestone X01, owner-approved; plug-and-play per D45 / `MOD-tasks.md`). Runs after MOD merges (needs `src/lib/modules/catalog.ts`, required `module` on every definition, `app.module_enabled` from 0084, `JOB_MODULES`) and after M08 (`attendance_sessions.period_id`) and M13 (holiday block). Migration `0085` (claimed; one file `supabase/migrations/20261028000085_student_leave_diary.sql`, T4 writes part 1, T5 appends part 2). No new deps. Module keys: `student_leave`, `diary` (category Communication, default on, no `requires`). Owning module folders: `src/modules/student-leave` (owns `student_leave_requests`), `src/modules/diary` (owns `diary_entries`, `diary_acknowledgements`). Attendance pre-marking is an attendance-owned SQL helper defined in 0085 (`app.premark_student_leave`), called only by the decide RPC. Replaces fixture: none. No UI (Workstream D).

Rulings:
- **Modules.** Catalog entries `student_leave` {label "Student leave", category "Communication", description "Parents apply for their child's leave; the class teacher approves and attendance is pre-marked.", default true} and `diary` {label "Class diary", category "Communication", description "Teachers post daily homework and notes per class; parents read and acknowledge.", default true}. Every X01 definition sets `module` (`studentLeave.*` → `student_leave`, `diary.*` → `diary`); both job types get `JOB_MODULES` rows.
- **`app.module_catalog` insert.** 0085 inserts `student_leave` and `diary` (both `default_enabled = true`) via `insert into app.module_catalog (key, default_enabled) values ('student_leave', true), ('diary', true) on conflict (key) do update set default_enabled = excluded.default_enabled`. `app.module_enabled` (MOD, 0084) is defined once and is never redefined here. The drift test (`tests/db/module-enabled-sql.test.ts`) decides.
- **`student_leave_requests`** columns: id; institution_id; student_id → students not null; class_section_id → class_sections not null (set by the guard from the active enrolment, never from input); start_date, end_date (check `end_date >= start_date and end_date - start_date <= 30`); reason text not null, 1–500; status `pending|approved|rejected|cancelled` default `pending`; created_by → profiles not null; decided_by → profiles null; decided_at timestamptz null; decision_note ≤ 500 null; created_at/updated_at + `set_updated_at`. Indexes `(institution_id, status)`, `(student_id, start_date)`, `(class_section_id, status)`. No leave type: the reason says it.
  RLS SELECT: `institution_id = any((select app.my_institution_ids(array['owner','principal','admin'])))` or `class_section_id = any((select app.my_class_teacher_section_ids()))` or `student_id = any((select app.my_student_ids()))`. INSERT: `app.has_role(institution_id, array['guardian'])` and `student_id in (select app.guardian_student_ids(institution_id))` (binds the student to the institution, lesson 2). No UPDATE or DELETE policy.
  Guard `app.guard_student_leave_requests` BEFORE INSERT OR UPDATE; bypass per lesson 5 only. INSERT: status := `pending`, decided_* := null, created_by := `app.current_user_id()`, class_section_id := the student's active enrolment section in that institution (none → `code:validation_failed`); `start_date < today(tz) - 7` → `code:validation_failed`; overlap with the student's own `pending|approved` rows (`daterange(start,end,'[]') &&`) → `code:conflict`. UPDATE: GUC `app.allow_student_leave_decision` must be `on`, else `code:forbidden`; institution_id, student_id, class_section_id, start_date, end_date, reason, created_by are immutable (`code:invalid_state`). today(tz) = `(now() at time zone coalesce(settings->'locale'->>'timezone','Asia/Kolkata'))::date`.
- **State machine.** `public.decide_student_leave(p_leave_id uuid, p_decision text, p_note text default null) returns public.student_leave_requests` (definer wrapper over the `app` impl, 0070 pattern). Steps in order:
  1. Auth, else `code:unauthenticated`.
  2. Decision not in `approved|rejected|cancelled`, or note > 500 chars → `validation_failed`.
  3. Lock the row. Missing, or the caller is not an active member of its institution → `not_found`.
  4. `approved|rejected`: owner/principal/admin of the institution, or the class teacher of `row.class_section_id` (`cs.class_teacher_id = app.staff_id(inst)`). `cancelled`: `created_by = caller` only. Else `forbidden`.
  5. Status ≠ `pending` → `invalid_state`. Approved, rejected and cancelled are terminal; an approved leave cannot be cancelled (the teacher corrects attendance via `attendance.correct`).
  6. Set status, decided_by/at, decision_note under the GUC.
  7. `approved` → `app.premark_student_leave(row)`.
  8. `approved|rejected` → `app.enqueue_job(inst, 'notify.student_leave_decided', jsonb_build_object('leave_id', id), 'student_leave:' || id)`.
  9. Audit `student_leave.approved|rejected|cancelled`: before `{status}`, after `{status}` (+ `premarked` count when approved).
  Never put the reason or note in audit, errors, logs or notification text: it may hold health details (lesson 10).
- **Pre-mark.** `app.premark_student_leave(p_leave public.student_leave_requests) returns int` (definer, `search_path=''`, revoked from everyone; only step 7 calls it). Leave code = `OL` (default set "On leave"; counts 0 present like `A`, so the % equals absent). If `OL` is not in `settings.attendance.statuses` → return 0. If the student is no longer actively enrolled in `p_leave.class_section_id` → return 0. For each date d in [start, end], skip Sunday (isodow 7); daily sessions only (`period_id is null`):
  - Session `open` → upsert the record (session, student) with status `OL`.
  - Session `submitted`, record exists and ≠ `OL` → insert `attendance_corrections` (old, `OL`, reason `Student leave approved`, corrected_by `app.staff_id(inst)`), update the record, audit `attendance.corrected` with the same shape as `public.correct_attendance`. No correction window: `OL` weighs like `A`. Record missing or already `OL` → skip.
  - No session and d < today(tz) → skip (no register was taken).
  - No session and d is a holiday → skip. Use the M13 `app.block_attendance_on_holiday` predicate (`calendar` module on and a `holiday` event covers d): call M13's helper if it exposes one, else copy the predicate.
  - No session otherwise → insert session `open` (marked_by null) + record `OL`.
  Returns the number of dates touched. Never touches period sessions. Never enqueues `notify.attendance_absence`.
- **`diary_entries`** columns: id; institution_id; class_section_id → class_sections not null; subject_id → subjects null (null = general note); entry_date date not null; body text not null, 1–2000; due_date date null (check `due_date >= entry_date`); requires_ack boolean not null default false; created_by → profiles not null; created_at/updated_at + `set_updated_at`. Indexes `(class_section_id, entry_date desc)`, `(institution_id, entry_date)`. No edit: delete and repost.
  RLS SELECT: admin trio (initPlan form above); `class_section_id = any((select app.my_taught_section_ids()))` (class and subject teachers); `class_section_id = any((select app.my_student_section_ids()))` (guardian/student). INSERT: (`app.has_role(institution_id, array['owner','principal','admin'])` or the taught-section initPlan) and the section and the subject (when set) belong to `institution_id` (lesson 2, table-qualified) and `created_by = (select app.current_user_id())`. DELETE: `created_by = (select app.current_user_id())` or `app.has_role(institution_id, array['owner','principal','admin'])`. No UPDATE policy. Posting is section-level: a teacher of the section may post any subject (debt).
  Trigger `app.enqueue_diary_entry_notification` AFTER INSERT (definer): `app.enqueue_job(new.institution_id, 'notify.diary_entry', jsonb_build_object('entry_id', new.id), 'diary:' || new.id)`. It does nothing under the lesson-5 bypass predicate, so seeded or imported rows never notify.
- **`diary_acknowledgements`** columns: id; institution_id; entry_id → diary_entries `on delete cascade` not null; student_id → students not null; acknowledged_by → profiles not null; created_at/updated_at + `set_updated_at`; unique `(entry_id, student_id)`.
  RLS SELECT: admin trio; `student_id = any((select app.my_student_ids()))`; teacher: `exists (select 1 from public.diary_entries e where e.id = diary_acknowledgements.entry_id and e.class_section_id = any((select app.my_taught_section_ids())))`. INSERT: `app.has_role(institution_id, array['guardian'])` and `student_id in (select app.guardian_student_ids(institution_id))` and `acknowledged_by = (select app.current_user_id())` and the entry is in the same institution, has `requires_ack`, and the student is actively enrolled in its section. No UPDATE or DELETE policy.
- **Permissions** (07 §2.2 rows, column order own pri adm ads acc exc tch stu grd):
  - `student_leave.request` = · · · · · · · · s (s = own children).
  - `student_leave.approve` = ✓ ✓ ✓ · · · s · · (s = class teacher of the student's section).
  - `diary.write` = ✓ ✓ ✓ · · · s · · (s = sections taught).
  Reads reuse existing keys: `studentLeave.list` → `attendance.read`; diary reads and `diary.acknowledge` → `assignment.read`. RLS narrows them; acknowledgement is guardian-only by RLS.
- **ErrorCode mapping.** RPC/trigger `code:*` via `mapSqlError`. `42501` → `forbidden`. `23505` on `diary_acknowledgements (entry_id, student_id)` → success (idempotent ack). `diary.entry.delete`: entry not visible → `not_found`; visible but 0 rows deleted → `forbidden`. `diary.acknowledge`: entry not visible → `not_found`; `requires_ack` false → `invalid_state`.
- **Audit**, exactly once per mutation: `student_leave.requested` (id) in TS; decisions only in SQL (no second TS audit); `diary.entry.posted` / `diary.entry.deleted` (entry id + section id). Acknowledgements are not audited: the row records who and when.
- **Notifications** through `createNotification` and the existing channel adapter (D42). New templates, bilingual en/hi like the existing ones:
  - `student_leave_decided`: channels in_app + sms, category `attendance`, vars {student, from, to, decision, school}. No reason or note. Recipients = guardians with portal access + the student (`guardiansAndStudents`, exported from `notify.announcement.ts`). entityId = leave id. Re-check at send: status is still `approved|rejected`.
  - `diary_entry`: channels in_app only (no per-homework SMS cost), category `academic`, vars {section, subject ("General" when null), excerpt (first 120 chars)}. Recipients = the section audience via `resolveRecipients` (exported). entityId = entry id. Re-check at send: the entry still exists.
  - `JOB_MODULES`: `notify.student_leave_decided` → `student_leave`, `notify.diary_entry` → `diary`. Teachers get no notification on a new request; they read `studentLeave.list`.
- **Honesty.** Nothing new is simulated. Leave-decision SMS goes through the existing adapter: simulated with its badge until a provider key exists (F-COM-05). No new badge.
- **India.** Mon–Sat school week (Sunday skipped); "today" = institution tz (default Asia/Kolkata); leave code `OL` from the default status set (05 §4.1); en/hi templates; diary is in-app only (SMS cost + DLT templates); retro leave up to 7 days back (the sick-note habit); the requester is the portal guardian.

Skipped (smallest version that does the core job): leave types and medical-certificate upload; office entry on a parent's behalf; cancelling an approved leave and un-marking; half-day leave; teacher notification on a new request; a row in M16 `core.approvals.pending`; diary edit (delete + repost), attachments, subject-teacher-only posting; read receipts beyond the explicit ack; any UI.

Routing: T1 haiku none [] ; T2 haiku none [] ; T3 haiku none [] ; T4 sonnet exclusive [1] ; T5 sonnet exclusive [4] ; T6 sonnet tests [2,3,4] ; T7 sonnet tests [3,4] ; T8 sonnet tests [2,3,5] ; T9 sonnet tests [3,5] ; T10 sonnet tests [4,5] ; T11 sonnet tests [6,7,8,9,10] ; T12 sonnet exclusive [5] ; T13 haiku none [11,12]

Every new action: `all-actions.ts` import + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `query-defs.ts` + `all-queries.ts` + smoke sample in `tests/db/api-query-route.test.ts`. Re-read shared registries (`permissions.ts`, catalog, `templates.ts`, `registry.ts`, manifests, rls-expectations) right before editing: other milestones touch them in parallel. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`). Tests that need dates use a helper that skips Sunday (previous / next school day).

---

### Task 1: X01-T1 Module keys `student_leave`, `diary` (Haiku)
READ: BRIEF-COMMON.md; rulings (Modules); `src/lib/modules/catalog.ts`; `tests/unit/modules-catalog.test.ts`
FILES: `src/lib/modules/catalog.ts` (2 entries inside the Communication run); `tests/unit/modules-catalog.test.ts`
MIGRATION: none. T4 adds the SQL side; `tests/db/module-enabled-sql.test.ts` stays red until T4, so the controller commits T1 + T4 together.
EXPORTS: `MODULES.student_leave`, `MODULES.diary` per rulings. The settings schema needs no edit (`modules` derives from `OPTIONAL_MODULE_KEYS`).
TEST FIRST: both keys optional, default on, category Communication, no `requires`; `{modules: {diary: false}}` parses and `isModuleEnabled` → false; entry count +2.
ACCEPT: `pnpm test tests/unit/modules-catalog.test.ts tests/unit/institution-settings.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 2: X01-T2 Permissions `student_leave.request`, `student_leave.approve`, `diary.write` (Haiku)
READ: BRIEF-COMMON.md; rulings (Permissions)
FILES: `src/lib/auth/permissions.ts` (union + `ROLE_PERMISSIONS`); `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2 (3 rows after `leave.approve`, with the `s` notes); `tests/unit/permissions.test.ts` (3 rows)
TEST FIRST: the 3 matrix rows (s cells = true).
ACCEPT: `pnpm test tests/unit/permissions.test.ts tests/unit/permission-literals.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 3: X01-T3 Zod schemas (Haiku)
READ: BRIEF-COMMON.md; `src/modules/people/hr.schemas.ts` (style, relative `.ts` imports); `src/lib/schemas/common.ts` (`uuid`, `isoDate`)
FILES: `src/modules/student-leave/schemas.ts` (new); `src/modules/diary/schemas.ts` (new); `tests/unit/x01-schemas.test.ts`
EXPORTS (all `.strict()`, inferred `*Input` types): student-leave: `STUDENT_LEAVE_STATUSES`; `StudentLeaveRequestSchema` {studentId, startDate, endDate, reason trim 1–500} (refine end ≥ start and ≤ 31 days inclusive); `StudentLeaveDecisionSchema` {leaveId, note? ≤ 500}; `StudentLeaveCancelSchema` {leaveId}; `StudentLeaveListSchema` {status?, studentId?, classSectionId?, from?, to?, limit? int 1–200}. diary: `DiaryPostSchema` {classSectionId, subjectId?, entryDate, body trim 1–2000, dueDate?, requiresAck? default false} (refine dueDate ≥ entryDate); `DiaryDeleteSchema` {entryId}; `DiaryAcknowledgeSchema` {entryId, studentId}; `DiaryForSectionSchema` {classSectionId, from?, to?}; `DiaryForStudentSchema` {studentId, from?, to?} (both refine from ≤ to and span ≤ 62 days); `DiaryAckStatusSchema` {entryId}.
TEST FIRST: valid inputs parse; end before start rejected; 32-day leave rejected; 501-char reason rejected; dueDate before entryDate rejected; 2001-char body rejected; 63-day window rejected; unknown key rejected.
ACCEPT: `pnpm test tests/unit/x01-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 4: X01-T4 Migration 0085 part 1 — student leave, pre-mark, `app.module_catalog` insert (DB owner)
READ: BRIEF-COMMON.md; rulings; `supabase/migrations/20261028000070_staffing.sql` (leave guard, GUC, decide RPC, wrapper, grants: mirror it); `…0014_attendance_submit.sql` (`correct_attendance`); `…0075*.sql` (holiday predicate); the `app.module_catalog` definition (0084, MOD); `tests/db/staff-leave-rls.test.ts` (fixture style)
FILES: `supabase/migrations/20261028000085_student_leave_diary.sql` (new; header comment names both parts); `tests/db/student-leave-rls.test.ts`; `src/lib/db/types.ts` (regen); `tests/security/rls-expectations.ts` (1 entry)
MIGRATION: `20261028000085_student_leave_diary.sql` (claimed).
EXPORTS: table, indexes, RLS, guard, `app.premark_student_leave`, `public.decide_student_leave` (`app` impl revoked from everyone; `public` wrapper granted to authenticated only), `app.module_catalog` insert (+ `student_leave`, `diary`).
TEST FIRST: guardian applies for own child → pending, class_section_id from the enrolment, created_by = self even if spoofed; for another family's child → 42501; start 8 days back → validation_failed; overlap → conflict; class teacher approves → approved + `audit_events` row without the reason; teacher of another section → forbidden; guardian approves → forbidden; approve twice → invalid_state; requester cancels pending → cancelled; another guardian cancels → not_found or forbidden; direct UPDATE of status → denied. Pre-mark: previous school day's submitted session with `A` → `OL` + one `attendance_corrections` row + `attendance.corrected` audit; today's open session → record `OL`; next school day (no session) → open session + `OL`; a past date without a session and a Sunday → nothing created; a holiday → no session; a period session is untouched; `OL` removed from settings → approve succeeds, nothing marked. Jobs: one `notify.student_leave_decided` job on approve and on reject, none on cancel. Reads: admin all, class teacher own sections only, guardian own children, student own, accountant and other teachers none.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/student-leave-rls.test.ts`; `pnpm test:db tests/db/module-enabled-sql.test.ts`; `pnpm test:security` (update expectations if needed, say so); `pnpm lint`; `pnpm typecheck`. Size: necessarily above ~150 lines (M07-T2 precedent).

### Task 5: X01-T5 Migration 0085 part 2 — diary (DB owner)
READ: BRIEF-COMMON.md; rulings (diary tables); 0085 part 1; `…0068_announcements.sql` (`app.enqueue_job` from SQL); `…0020_rls_performance.sql` (initPlan helpers)
FILES: `supabase/migrations/20261028000085_student_leave_diary.sql` (append); `tests/db/diary-rls.test.ts`; `src/lib/db/types.ts` (regen); `tests/security/rls-expectations.ts` (2 entries)
EXPORTS: 2 tables, indexes, RLS, `app.enqueue_diary_entry_notification` + trigger.
TEST FIRST: class teacher posts for own section → ok and one `notify.diary_entry` job with `{entry_id}` only; subject teacher of the section → ok; teacher of another section → 42501; admin of A with B's section or subject → 42501; spoofed created_by → 42501; guardian of a VI-A child sees VI-A entries, not VIII-B; student sees own section; accountant sees none; service-role insert → no job; guardian acks own child's `requires_ack` entry → ok, second time → 23505; ack on an entry without `requires_ack` → 42501; ack for another family's child → 42501; teacher ack → 42501; teacher reads acks of a taught section, another guardian does not; author deletes → acks cascade; non-author teacher delete → 0 rows; UPDATE → denied.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/diary-rls.test.ts tests/db/student-leave-rls.test.ts`; `pnpm test:security`; `pnpm lint`; `pnpm typecheck`

### Task 6: X01-T6 Student leave actions
READ: BRIEF-COMMON.md; rulings; T4 SQL; T3 schemas; `src/modules/people/leave.actions.ts` (mirror)
FILES: `src/modules/student-leave/actions.ts` (new, `"use server"`); `tests/db/student-leave-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (module `student_leave`): `studentLeave.request` (`student_leave.request`; RLS insert with institution_id from ctx; audit `student_leave.requested` id only; returns `{id, status}`); `studentLeave.approve` / `studentLeave.reject` (`student_leave.approve`) → `decide_student_leave`; `studentLeave.cancel` (`student_leave.request`) → `decide_student_leave(…, 'cancelled')`. Decisions return `{id, status}`.
TEST FIRST: guardian requests → pending; another family's child → forbidden; overlap → conflict; class teacher approves → approved; other-section teacher → forbidden; reject then approve → invalid_state; guardian cancels pending → cancelled; teacher calls request → forbidden.
ACCEPT: `pnpm test:db tests/db/student-leave-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 7: X01-T7 Student leave query
READ: BRIEF-COMMON.md; rulings; `src/modules/people/hr.queries.ts` + `hr.query-defs.ts` (pattern); `timetable.forSection` (section display name)
FILES: `src/modules/student-leave/queries.ts`; `src/modules/student-leave/query-defs.ts`; `tests/db/student-leave-queries.test.ts`; + `all-queries.ts` line + smoke sample
EXPORTS: `studentLeave.list` (`attendance.read`, `StudentLeaveListSchema`, module `student_leave`) → `StudentLeaveRow[]` {id, studentId, studentName, classSection, startDate, endDate, days (inclusive calendar days), reason, status, decidedAt, decisionNote, createdAt}; pending first, then start_date descending; default limit 50; RLS is the only row filter. Export the `StudentLeaveRow` type.
TEST FIRST: guardian sees only own children's rows; class teacher sees own section's pending row; teacher of another section sees none; admin filters `status: "pending"`; accountant → forbidden.
ACCEPT: `pnpm test:db tests/db/student-leave-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 8: X01-T8 Diary actions
READ: BRIEF-COMMON.md; rulings; T5 SQL; T3 schemas; `src/modules/notifications/announcements.actions.ts` (style, 42501/23505 mapping)
FILES: `src/modules/diary/actions.ts` (new, `"use server"`); `tests/db/diary-actions.test.ts`; + manifest line + C-03 fixtures
EXPORTS (module `diary`): `diary.entry.post` (`diary.write`; insert with created_by = the caller's user id; 42501 → forbidden "You do not teach this section."; audit; returns `{id}`); `diary.entry.delete` (`diary.write`; not_found / forbidden per rulings; audit); `diary.acknowledge` (`assignment.read`; not_found / invalid_state per rulings; 23505 → ok; returns `{entryId, studentId, acknowledged: true}`).
TEST FIRST: class teacher posts → ok; teacher of another section → forbidden; dueDate before entryDate → validation_failed; author deletes → ok; non-author teacher → forbidden; other-section teacher → not_found; guardian acks twice → ok both times; ack on a no-ack entry → invalid_state; teacher ack → forbidden; guardian post → forbidden.
ACCEPT: `pnpm test:db tests/db/diary-actions.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 9: X01-T9 Diary queries
READ: BRIEF-COMMON.md; rulings; T5 SQL; `src/modules/timetable/queries.ts` (`forStudent` enrolment resolution, tz "today")
FILES: `src/modules/diary/queries.ts`; `src/modules/diary/query-defs.ts`; `tests/db/diary-queries.test.ts`; + `all-queries.ts` line + smoke samples
EXPORTS (module `diary`; default window today−6 … today+7 in institution tz):
- `diary.forSection` (`assignment.read`) {classSectionId, from?, to?} → `DiaryEntryRow[]` {id, entryDate, subject: {id, name} | null, body, dueDate, requiresAck, ackCount: number | null}. ackCount is null unless the caller holds `diary.write`. Newest entry_date first, then created_at.
- `diary.forStudent` (`assignment.read`) {studentId, from?, to?} → resolves the student's active enrolment section (invisible under RLS → `[]`), then the same rows with `acknowledged: boolean` for that student.
- `diary.ackStatus` (`diary.write`) {entryId} → entry not visible → `not_found`; else the actively enrolled students of its section `{studentId, name, rollNo, acknowledged, acknowledgedAt}[]` by roll number.
TEST FIRST: forSection returns the window newest first; guardian forStudent for own child → entries with `acknowledged`; for another family's child → `[]`; ackStatus lists the section with one acknowledged; guardian ackStatus → forbidden; teacher of another section ackStatus → not_found.
ACCEPT: `pnpm test:db tests/db/diary-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 10: X01-T10 Templates + job handlers
READ: BRIEF-COMMON.md; rulings (Notifications); `src/modules/notifications/templates.ts`; `src/modules/jobs/handlers/notify.announcement.ts`, `handlers/index.ts`, `src/modules/jobs/registry.ts` (`JOB_MODULES`); `tests/db/notify-announcement.test.ts`
FILES: `src/modules/notifications/templates.ts` (2 types + 2 templates); `src/modules/jobs/handlers/notify.student_leave_decided.ts` (new); `src/modules/jobs/handlers/notify.diary_entry.ts` (new); `tests/db/notify-x01.test.ts`; + registration in `handlers/index.ts`/`registry.ts`, 2 `JOB_MODULES` rows, one-word `export` on `guardiansAndStudents` and `resolveRecipients` in `notify.announcement.ts`
EXPORTS: `notifyStudentLeaveDecided`, `notifyDiaryEntry` (`JobHandler`); relative `.ts` imports in runner-loaded files.
TEST FIRST: approved-leave job → the portal guardian and the student get `student_leave_decided` in-app, an sms attempt only where preferences allow, body without the reason; rerun → nothing new; diary job → guardians and students of that section only, in-app only (no sms/email `delivery_attempts`); job for a deleted entry → no notification; existing announcement tests stay green.
ACCEPT: `pnpm test:db tests/db/notify-x01.test.ts tests/db/notify-announcement.test.ts tests/db/jobs.test.ts`; `pnpm test tests/unit/notification-templates.test.ts tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 11: X01-T11 Acceptance over HTTP
READ: BRIEF-COMMON.md; `tests/db/announcements-acceptance.test.ts`, `tests/db/timetable-acceptance.test.ts` (pattern)
FILES: `tests/db/x01-acceptance.test.ts`
TEST, all via `/api/v1/actions/*` and `/api/v1/query/*` on a fixture institution. Steps in order:
1. The class teacher marks and submits the previous school day's register with the child `A` (`attendance.mark` + `attendance.submit`).
2. Guardian `studentLeave.request` for own child, previous school day … next school day → 200. For another family's child → 403. Overlapping → 409.
3. Teacher of another section `studentLeave.approve` → 403. The class teacher → 200. The previous day's record is `OL` with one `attendance_corrections` row and an `attendance.corrected` audit; the next school day has an open session with `OL`.
4. Run the job runner once. Guardian `notifications.listMyNotifications` shows the leave decision; guardian `studentLeave.list` shows `approved`.
5. Class teacher `diary.entry.post` with `requiresAck` → 200; run the runner; the guardian is notified. Guardian `diary.forStudent` → the entry with `acknowledged: false`; `diary.acknowledge` twice → 200 both; teacher `diary.ackStatus` → acknowledged. Another guardian's `diary.forStudent` for this child → `[]`.
6. Owner `core.module.set` `{key: "diary", enabled: false}`; `diary.entry.post` → 403 with `MODULE_DISABLED_MESSAGE`; turn it back on. This is X01's one module-off test.
ACCEPT: `pnpm test:db tests/db/x01-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 12: X01-T12 Seed section `homeroom` (seed owner)
READ: BRIEF-COMMON.md; rulings; `05-data-architecture.md` §8.1 (named entities, attendance % contract, live VI-A register); `scripts/seed/sections/timetable.ts` (PRNG/uuidV5/`insertBatch`); `scripts/seed/index.ts`; `tests/db/seed-timetable.test.ts`, `seed-determinism.test.ts`
FILES: `scripts/seed/sections/homeroom.ts` (new, relative `.ts` imports); `scripts/seed/index.ts` (register last); `tests/db/seed-homeroom.test.ts` (+ the 3 tables in `seed-determinism.test.ts` if it enumerates tables)
EXPORTS: deterministic ids, dates relative to the run date. d0 = today if Mon–Sat, else the next Monday; d1 = the next school day after d0. Service role (guard bypass), explicit created_by/decided_by. No attendance rows are written or changed (named students' % and today's live VI-A register stay as seeded).
- `student_leave_requests`:
  - Pending: Aarav Sharma (`guardian.one`), d1 … d1, reason "Family function", created 3 h before the run. `teacher.vi-a` approves it live in the demo; pre-marking then touches only d1.
  - Rejected: Ishaan Mehta (`guardian.two`), a past school day, decided by `teacher.viii-b`.
  - Approved: one non-named VI-A student, two days in June 2026 (before seeded attendance starts on 2026-07-01, so nothing to pre-mark).
- `diary_entries` for VI-A, VIII-B, X-A, created_by the section's class teacher: on the previous school day and on d0, two subject homework entries each (subjects from that section's `subject_assignments`, due the next school day), plus on d0 one general note with `requires_ack` ("Parent-teacher meeting on Saturday at 10 am. Please acknowledge."). 15 rows.
- `diary_acknowledgements`: `guardian.two` acknowledges VIII-B's note for Ishaan. `guardian.one` has not acknowledged (live demo step).
TEST FIRST: the demo tenant has the pending Aarav leave starting after today, plus the rejected and the approved row; VI-A's d0 note is unacknowledged for Aarav; VIII-B's note is acknowledged for Ishaan; the seed created no `notify.diary_entry` jobs; no attendance session is dated after today; reseed gives identical ids.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset`; `pnpm test:db tests/db/seed-homeroom.test.ts tests/db/seed-determinism.test.ts tests/db/seed-attendance.test.ts`; `pnpm lint`; `pnpm typecheck`

### Task 13: X01-T13 Docs (Haiku)
FILES:
- `docs/planning/coolskool/03-feature-matrix.md`: two rows, next free IDs at edit time (re-read first). In §D: "Student leave requests: guardian applies, class teacher approves, attendance pre-marked `OL`" · Phase 2 · Demo `impl (API; UI in Workstream D)` · P1 · Deps F-ATT-01, F-COM-01 · Owner student-leave · Sens conf · Accept `tests/db/x01-acceptance.test.ts`. In §C: "Class diary: daily homework/notes per section, parent acknowledgement" · Phase 2 · `impl (API; UI in Workstream D)` · P1 · F-COM-01 · diary · int · same test. Leave F-COM-03 and F-ATT-04 unchanged.
- `docs/planning/coolskool/10-backlog-index.md` §3: `0085` → built.
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4: one row "SQL `security definer` — student leave + diary (X01, `20261028000085`)" covering `decide_student_leave`, `app.premark_student_leave`, `app.enqueue_diary_entry_notification`, the `app.module_catalog` insert, and the guard under GUC `app.allow_student_leave_decision`. Copy the staffing row style.
- `docs/planning/coolskool/12-decision-log.md` §3: debt rows, next free DBT numbers:
  - Leave overlap is checked by a trigger, so it can race. Upgrade: a `btree_gist` exclusion constraint.
  - Pre-marking creates open sessions for future dates. Dashboards may show the section as started. A holiday declared later, a non-working Saturday, or a section change after approval leaves that session in place.
  - An approved leave cannot be cancelled or un-marked. The leave code is fixed to `OL` (no setting).
  - Diary posting is section-level: any teacher of the section may post any subject. No edit. No attachments.
  - No teacher notification on a new leave request. Pending student leave is not in M16 `core.approvals.pending`.
ACCEPT: rows render as tables (no broken pipes); `pnpm lint`

---

Controller after T13: security review (Sonnet) on the 0085 diff, actions and handlers (RLS, definers, pre-mark writes to attendance); fix CRIT/HIGH/MED; full gate; `pnpm db:reset` + `pnpm seed` clean; commit/push; hosted push owner-run; `DONE X01 <sha>`.
