Packet: T-0NN M08-T10 attendance.markPeriod action + attendance.periodSummary query + db test
Files changed: src/modules/attendance/actions.ts, src/modules/attendance/queries.ts,
  src/modules/attendance/query-defs.ts, tests/db/period-attendance-actions.test.ts,
  tests/security/escalation.test.ts (+fixture), tests/db/api-query-route.test.ts (+sample)
Behavior implemented: attendance.markPeriod validates status codes vs settings then calls
  mark_period_attendance RPC (auth/state machine lives in RPC, 0070); attendance.periodSummary
  lists every non-break period + session/counts for a section+date, RLS-filtered.
Tests run: pnpm test:db tests/db/period-attendance-actions.test.ts tests/db/api-query-route.test.ts
  -> 2 files, 10 passed; pnpm test:security tests/security/escalation.test.ts -> 842 passed;
  pnpm lint -> 0 errors (3 pre-existing warnings in other packets' files);
  pnpm typecheck -> clean except 2 pre-existing errors in curriculum.actions.ts and
  substitution.actions.ts (not touched by this task, named per brief).
Tests not run and why: full test:db / db:reset / seed / db:types — not DB owner this round.
Limitations / honesty label: no UI; none needed (no simulated/limited surface added).
Security / integration risks: periodSummary leans entirely on existing attendance_sessions/
  attendance_records RLS (DBT-49 debt already on file: a substitute not teaching the section
  can't read it back) — no new narrowing added here, matches ruling.
Follow-ups: none new; DBT-49 already covers the RLS-visibility gap for period attendance.
New dependencies (justification): none
Assumptions made: periodSummary dedupes/ignores sessions on break periods by filtering
  is_break=false at the periods query, not by excluding any stray break-period session row.
