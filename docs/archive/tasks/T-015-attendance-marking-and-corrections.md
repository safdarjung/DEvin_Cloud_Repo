# T-015 — Attendance marking, submit, corrections, absence jobs

| Field | Value |
|---|---|
| Lane / Day | A / Day 6–7 |
| Size | 1.5 agent-days |
| Critical path | no |
| Review | code-reviewer |
| Feature ids | F-ATT-01, F-ATT-02, F-ATT-03, F-ATT-05 |
| Depends on | T-014, T-013 (merged) |
| Migration | — |

## Business outcome
A class teacher opens today's register for their section, marks everyone in under a minute, submits, and every absent student's primary guardian is queued a notification. Mistakes are corrected with a reason and an audit trail.

## Current repo state (verify before starting)
- Attendance tables and types exist: `grep -n "attendance_records" src/lib/db/types.ts | head -3`.
- Seeded sections and enrolments exist: `pnpm db:reset` then check `/[institution]/dashboard` renders for `teacher.vi-a`.
- `defineAction`, `requirePermission`, `audit` exist: `ls src/lib/actions/define-action.ts src/lib/auth/require.ts src/lib/audit.ts`.
- `app.enqueue_job` exists: `grep -n "enqueue_job" supabase/migrations/20261028000003_platform.sql`.

## Spec sections to read (only these)
`06-workflows-and-contracts.md §1`, `§W5`, `§3` (attendance_absence) · `05-data-architecture.md §2.4`, `§4.1` (attendance) · `07 §2` (attendance rows) · `08 §3 C-15, C-16`, `§4 J-06` · `04-architecture.md §3`, `§7`.

## Files to inspect first
`src/lib/actions/define-action.ts` · `src/lib/auth/context.ts` (`TenantContext.membership.staff_id`) · `src/modules/academics/queries.ts` (sections for a teacher, enrolled students) · `src/lib/nav.ts`.

## Expected changes
- `src/modules/attendance/schemas.ts` — `MarkAttendanceSchema`, `SubmitAttendanceSchema`, `CorrectAttendanceSchema` (status validated against `ctx.institution.settings.attendance.statuses`).
- `src/modules/attendance/actions.ts` — `markAttendance`, `submitAttendance`, `correctAttendance` per `06 §W5`; submit enqueues `notify.attendance_absence` per record whose status has `notify_guardian: true`, idempotency key `absence:<record_id>`; correction window from `settings.attendance.correction_window_days`; audit `attendance.submitted`, `attendance.corrected`.
- `src/modules/attendance/queries.ts` — `getTodaySectionsForTeacher`, `getSession(sectionId, date)`, `getStudentAttendanceSummary(studentId, termId)` (uses `counts_present` / `in_denominator`).
- `src/modules/attendance/components/` — `AttendanceRegister` (client, keyboard-friendly status toggles), `CorrectionDialog`, `StudentAttendanceSummary` (server; exported for the portal and student profile).
- `src/app/(tenant)/[institution]/attendance/page.tsx`, `.../attendance/[sectionId]/page.tsx` — today's sections; register for a section/date.
- `src/lib/nav.ts` — one line: `attendance` item guarded by `attendance.mark` or `attendance.read`.
- `tests/unit/attendance-summary.test.ts`, `tests/db/attendance-actions.test.ts`, `e2e/j06-attendance.spec.ts`.

## Must not modify
`supabase/migrations/**` · `src/lib/auth/permissions.ts` · `src/modules/jobs/**` (handler written in T-038) · `src/modules/notifications/**`.

## Permissions / nav / migration numbers needed from the lead
Nav line for `/attendance` (declared in this packet, merged by the lead). Permissions already present.

## Security and data-integrity requirements
- Action layer narrows marking to the class teacher of the section or roles `owner|principal|admin` (RLS allows subject teachers; the action does not).
- `date` must be ≤ today (institution timezone); dates older than 7 days require `attendance.correct`.
- Resubmission is idempotent (same job keys, no duplicate records).
- Corrections never overwrite the correction log; `before`/`after` go to audit.

## Acceptance criteria
1. `teacher.vi-a` sees only VI-A under `/attendance`; `teacher.viii-b` cannot open VI-A's register (`forbidden`).
2. Marking 42 students and submitting creates one session, 42 records, and N queued jobs for N absences (`select count(*) from jobs where type = 'notify.attendance_absence'`).
3. Submitting twice leaves counts unchanged.
4. A correction from `A` to `OL` within the window by the class teacher succeeds; after the window as teacher → `forbidden`; as `admin` → succeeds; `attendance_corrections` has one row; `audit_events` has `attendance.corrected`.
5. `StudentAttendanceSummary` shows percentage consistent with `settings.attendance.statuses` weights (unit-tested boundaries).
6. J-06 passes locally.

## Tests (write failing tests first) and exact commands
- `tests/unit/attendance-summary.test.ts` (percentage math, thresholds).
- `tests/db/attendance-actions.test.ts` (C-15, C-16 at action level, idempotent submit, job rows).
- `e2e/j06-attendance.spec.ts` (J-06 without the message-log assertion until T-038 lands; add it then).
- `pnpm test -- tests/unit/attendance-summary.test.ts` · `pnpm test:db -- tests/db/attendance-actions.test.ts` · `pnpm test:e2e -- e2e/j06-attendance.spec.ts`

## Deliverables
Module files, pages, nav line, tests, completion report with job-count evidence.

## Assumptions and risks
- Daily single-mark mode only (`settings.attendance.mode = 'daily'`).
- Until T-038 merges, jobs stay queued; the message log assertion in J-06 is added by T-038's owner.
- Register for 42 rows must stay responsive: use a single client component with local state and one action call on submit.

## Completion report
Use the format in `CLAUDE.md`.
