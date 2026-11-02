Packet: M08-T4 Migration 0070 part 3: period attendance + daily-reader compat
Files changed: supabase/migrations/20261028000070_staffing.sql (append); tests/db/period-attendance-rls.test.ts (new); tests/security/grants.test.ts (append PUBLIC_AUTHENTICATED row); src/lib/db/types.ts (regen); src/modules/attendance/actions.ts, src/modules/attendance/queries.ts, scripts/load/l1-attendance-burst.ts (compat, 7 lines)
Behavior: attendance_sessions.period_id + unique swap (nulls not distinct); app.guard_attendance_sessions_period (lesson 5); public.mark_period_attendance (slot/weekday lookup, admin/slot-teacher/assigned-substitute scope, 7-day non-admin window, enrolment check, open->records->submitted write order, no notify job, audit attendance.period_marked); app.term_attendance_percentage create-or-replace filters period_id is null.
Tests run: pnpm test:db tests/db/period-attendance-rls.test.ts tests/db/attendance-actions.test.ts tests/db/attendance-pattern-paging.test.ts tests/db/teacher-agent-attendance-scope.test.ts -> 4 files, 19 passed. pnpm test:security -> 18 files, 1513 passed. pnpm lint, pnpm typecheck -> clean.
Tests not run and why: none skipped.
Limitations/honesty: no UI this milestone (per ruling); self-reported substitution flow has no notification (debt, per packet).
Security/integration risks: none found; grants.test.ts PUBLIC_AUTHENTICATED list and the GUC NULL-safety check both now green for mark_period_attendance.
Follow-ups: 07-security-and-ai-governance.md §4 definer-row table has no M08 entry yet (T2/T3 didn't add one either) — not in this packet's FILES list; leaving for T15 (Docs) or a follow-up.
New dependencies: none.
Assumptions: src/modules/attendance/schemas.ts changed by a concurrent agent (not touched here, ignored per brief).
