Packet: T-015 Attendance marking, submit, corrections, absence jobs

Files changed:
- `supabase/migrations/20261028000014_attendance_submit.sql` (new, lead-reserved number)
- `src/modules/attendance/{schemas,actions,queries}.ts` (new)
- `src/modules/attendance/components/{AttendanceRegister,CorrectionDialog,StudentAttendanceSummary}.tsx` (new)
- `src/app/(tenant)/[institution]/attendance/page.tsx`, `.../attendance/[sectionId]/page.tsx` (new)
- `tests/unit/attendance-summary.test.ts`, `tests/db/attendance-actions.test.ts` (new)
- `e2e/j06-attendance.spec.ts` (new)
- `tests/db/attendance-schema.test.ts` (edited — see "Deviations")
- `tests/security/rls-expectations.ts` (edited — doc-only `write` field annotations for the three attendance tables)
- `docs/planning/coolskool/10-backlog-index.md` §3, `07-security-and-ai-governance.md` §4 (edited, per lead rulings — recorded 0014 and its two new definers)
- `src/lib/db/types.ts` (regenerated via `pnpm db:types`; diff is additions-only — two new `Functions` entries)
- Nav: `/attendance` line was already present in `src/lib/nav.ts` (pre-existing, permission `attendance.read`) — no change needed, nothing to hand the lead.

## RPCs and their checks

**`public.submit_attendance(p_institution_id, p_session_id)`** — `supabase/migrations/20261028000014_attendance_submit.sql:28-98`.
- Auth: `app.current_user_id()` null → `code:unauthenticated` (line 36).
- Scope: `app.has_role(owner|principal|admin)` OR caller's `app.staff_id` matches the session's section's `class_teacher_id` (lines 44-59) — narrower than `app.teaches_section` (excludes subject-only teachers), matching the packet.
- Not found: session must belong to `p_institution_id` (lines 38-42).
- Idempotent: `status = 'submitted'` already → returns as-is, no second write (lines 61-63).
- Side effects (one transaction): session → `submitted` + `submitted_at` + `marked_by` (65-69); one `app.enqueue_job('notify.attendance_absence', {record_id}, 'absence:<id>')` per record whose configured status has `notify_guardian: true` (75-90); `app.audit('attendance.submitted', ...)` with `before/after` status and a `metadata` object `{record_count, notified_count}` (92-99).
- Grants: revoked from `public`/`anon`, granted to `authenticated` only (line 101-102).

**`public.correct_attendance(p_institution_id, p_record_id, p_new_status, p_reason)`** — same file, lines 117-217.
- Auth + reason validation (non-empty, ≤200 chars) first (134-137).
- Not found: record must belong to `p_institution_id` (139-146).
- Role/window: owner/principal/admin any time; a class teacher only within `settings.attendance.correction_window_days` of the session's date, else `code:forbidden` (160-176).
- Status validation against `settings.attendance.statuses[*].code` (178-189); same status as current → `code:invalid_state` (193-196).
- One transaction: insert `attendance_corrections` (old/new/reason/corrected_by), update the record, `app.audit('attendance.corrected', ..., {status:old}, {status:new})` (198-213).
- Grants: `authenticated` only. Directly PostgREST-callable — its own checks are the boundary, per the lead ruling.
- Deviation: does **not** enqueue `notify.attendance_updated` (W5's notifying→non-notifying case) — no handler exists (`src/modules/jobs/handlers/` has none) and it isn't in this packet's acceptance criteria. Documented in the migration's own comment. Follow-up for whoever lands that handler.

## Policy changes (bypass closures, 0014, never editing 0006)

- `attendance_sessions_update`: `using`/`with check` now both require `status <> 'submitted'` — a session can never be directly set to or left at `submitted`; only `submit_attendance` can make that transition.
- `attendance_records_insert`/`_update`: added `s.status = 'open'` to the existing session-join subquery — once a session is submitted, its records change only via `correct_attendance`.
- `attendance_corrections_insert`: dropped, no replacement. RLS now default-denies all direct INSERTs; only `correct_attendance` (table owner, bypasses RLS) can write a correction.

## Bypass-closure tests

All in `tests/db/attendance-schema.test.ts` (new tests + one existing test updated):
- "T-015 fix: attendance_corrections has no direct INSERT policy for any role" — teacher/owner/principal/admin all rejected.
- "T-015 fix: direct UPDATE can never set or leave attendance_sessions.status = 'submitted'" — 0 rows affected both ways (set, and reopen).
- "T-015 fix: direct INSERT/UPDATE on attendance_records is blocked once the session is submitted".
- Existing "C-15" test previously inserted a correction directly as the teacher client (now blocked by design) — switched its setup insert to the raw admin `sql` connection (still proves the append-only `block_mutation` trigger) and added the new "no direct insert" test above to cover what C-15 used to assert about *who* may insert.

## AC2 job-count evidence (actual output)

`tests/db/attendance-actions.test.ts` "AC2/AC3" test: 42 students, 5 marked `A`, 37 marked `P`, one `markAttendance` call, one `submitAttendance` call.
```
select count(*) from attendance_sessions where institution_id = :inst  -> 1
select count(*) from attendance_records where institution_id = :inst  -> 42
select count(*) from jobs where institution_id = :inst and type = 'notify.attendance_absence' -> 5
audit_events action='attendance.submitted' -> 1 row, metadata {"record_count":42,"notified_count":5}
-- resubmit:
sessions -> 1 (unchanged), jobs -> 5 (unchanged), audit rows for 'attendance.submitted' -> 1 (unchanged)
```
Full test run output: `Test Files 2 passed (2) / Tests 17 passed (17)` for `attendance-actions.test.ts` + `attendance-schema.test.ts` together.

## Context7 / docs-lookup

Checked `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-server.md` and `.../page.md` directly (Next 16.4 pinned version) rather than dispatching the `docs-lookup` agent, since the two facts needed were a single grep/read each:
- A `"use server"` file may only export async functions — removed a stray non-async helper export from `actions.ts` before it could hit this at build time.
- `page.tsx`'s `searchParams` prop is a `Promise` in this version — awaited it in `attendance/[sectionId]/page.tsx`.
No other library APIs were touched that weren't already established patterns in the codebase (RPC calls, `defineAction`, RLS helpers) — confirmed those by reading the existing `jobs_requeue`/`record_audit_event` precedent instead of re-deriving from docs.

## Deviations / assumptions

1. **Marking is a bulk upsert, not per-student calls** — one `markAttendance` call carries every row; `submitAttendance` is a separate explicit action (packet: "one action call on submit" read as "one call per bulk submission", not literally one button total).
2. **Correction window computed from `settings.attendance.correction_window_days`** inside the RPC, not in TS — the RPC is the real boundary (lead ruling), so the TS action does not duplicate the check.
3. **`notify.attendance_updated` not enqueued** (see RPC section above) — explicit follow-up.
4. **Seed data bug found, not fixed**: after `pnpm demo:reset`, the academics seed (`scripts/seed/sections/academics.ts`, not my file) assigns the "VI-A Class Teacher" staff row as `class_teacher_id` of *two* sections (I-A and VI-A), not just VI-A. AC1 ("teacher.vi-a sees only VI-A") is proved cleanly at the action layer with an isolated fixture in `attendance-actions.test.ts`; the e2e spec works around the seed bug by scoping to the VI-A row specifically. Flagged in a comment at the top of `e2e/j06-attendance.spec.ts` for the academics-seed owner.
5. **`/attendance` page for read-only roles** (student/guardian/exam_controller with `attendance.read` but not `.mark`) shows a short notice rather than a register — the per-student percentage view lives via `StudentAttendanceSummary`, wired into the portal/profile by whichever packet owns those pages (not named in this packet's "Expected changes").

## Tests run (actual output)

1. `pnpm db:reset` — migrations applied clean through `20261028000014`, types regenerated, seed ran (3024 students, 106 staff, 72 sections).
2. `pnpm vitest run --project db tests/db/attendance-actions.test.ts tests/db/attendance-schema.test.ts` → `Test Files 2 passed (2) / Tests 17 passed (17)`.
3. `pnpm test:security` → `Test Files 2 passed (2) / Tests 321 passed (321)`.
4. `pnpm test:db` (full) → `Test Files 20 passed (20) / Tests 123 passed (123)` (one transient failure in `website-schema.test.ts` on a prior run, unrelated file, passed clean on immediate rerun — pre-existing flakiness, not caused by this change).
5. `pnpm test` (full unit) → `Test Files 16 passed (16) / Tests 141 passed (141)`.
6. `pnpm lint && pnpm typecheck` → clean for every file this packet touched (5 pre-existing warnings remain in other agents' seed stub files, untouched by me).
7. `pnpm demo:reset` then `pnpm test:e2e e2e/j06-attendance.spec.ts` → `3 passed`.

## Limitations / honesty label

No simulated or limited-feature UI surface is introduced by this packet (attendance marking/correction are real writes; the SMS notification itself is simulated per 06 §3, but that label belongs to the notification surface T-038 owns, not this one). No new `<SimulatedBadge />`/`<LimitedBadge />` needed here.

## Security / integration risks

- `correct_attendance`/`submit_attendance` are PostgREST-callable directly; both are `authenticated`-only and self-contained auth checks — reviewed the grant lines explicitly.
- The dropped `attendance_corrections_insert` policy and the tightened session/record policies were each proven with a dedicated test (see above) rather than inferred.

## Follow-ups (for `12-decision-log.md` §Debt)

- `notify.attendance_updated` handler + enqueue call, once a handler exists for it.
- Academics seed assigns one staff row as class teacher of two sections (I-A and VI-A) — likely a random-assignment bug in `scripts/seed/sections/academics.ts`; not this packet's file.

## New dependencies

None.

## Assumptions made

- `settings.attendance.mode = 'daily'` (single-mark mode) per packet assumption — no period-based marking UI built.
- Institution timezone for "today" read from `settings.locale.timezone`, falling back to `Asia/Kolkata` if unparseable.

## Fix round 1

MEDIUM from security review: `correct_attendance`'s window check used `current_date` (DB session UTC date), not the institution's local date, so from IST 00:00–05:29 a teacher got one extra day of correction window. Fixed in place in `20261028000014_attendance_submit.sql` (unmerged) — the window check now computes `(now() at time zone v_timezone)::date`, with `v_timezone` read from `settings.locale.timezone` (default `Asia/Kolkata`, same default as `DEFAULT_INSTITUTION_SETTINGS`), matching `todayInTimezone()` in `actions.ts`. Checked `submit_attendance` and the rest of 0014 for the same issue — no other `current_date`/date-boundary logic exists there.

Added a db test ("security fix: the correction window boundary uses the institution's local timezone, not UTC") using `Pacific/Kiritimati` (UTC+14) so the institution's local date differs from UTC's for most of each day: a record dated exactly at the local-date window edge succeeds, one day further back is forbidden. Verified the test actually catches the regression by temporarily reverting the fix to `current_date` and rerunning — it failed as expected; restored the fix and reran clean. `now()` itself is never mocked.

Tests run (actual): `pnpm db:reset` clean; `pnpm vitest run --project db tests/db/attendance-actions.test.ts tests/db/attendance-schema.test.ts` → 18/18 passed; `pnpm test` → 160/160 passed; `pnpm lint` → 0 errors (4 pre-existing warnings in other agents' seed stub files); `pnpm typecheck` → clean.
