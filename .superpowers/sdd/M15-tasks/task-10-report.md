Packet: M15-T10 Schedule actions
Files changed: src/modules/reports/actions.ts (new); tests/db/report-actions.test.ts (new); src/app/api/v1/actions/all-actions.ts (+1 import line); tests/security/escalation.test.ts (+2 C-03 fixtures: report.schedule.save, report.schedule.setStatus)
Behavior implemented: report.schedule.save (insert or update-by-id, module scheduled_reports, permission report.schedule); report.schedule.setStatus; mapRow camelCases DB row; 23505 on (institution_id,name) -> conflict+fieldErrors.name; mapSqlError/throwMapped relay trigger's code:validation_failed/code:forbidden; cross-institution update -> not_found (eq institution_id); audit report.schedule.saved {id,source} / report.schedule.status_set {id,status}.
Tests run: pnpm test:db tests/db/report-actions.test.ts -> 3 passed; pnpm test tests/unit/action-names-unique.test.ts -> 6 passed; pnpm test:security tests/security/escalation.test.ts -> 1082 passed; pnpm lint -> 0 errors (2 pre-existing warnings in tests/db/report-queries.test.ts, not my file, untouched); pnpm typecheck -> clean.
Tests not run and why: full test:db / db:reset / seed / db:types per DB-owner fence (not this task's DB owner); T11/T12/T13 suites (other tasks).
Limitations / honesty label: n/a (backend action only, no UI).
Security / integration risks: none new — RLS/write-guard/permission gates all come from T1-T5; action layer adds no bypass. insert() needed an explicit `created_by: ctx.user.id` (generated Insert type has no column default) even though the write-guard trigger overrides it for non-trusted callers anyway — same value either way.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: db test's "next 20:00 Asia/Kolkata" check computed from IST calendar date of `new Date()` taken just before the call (tiny flake window at the UTC/IST day-boundary tick, same risk as any real-now cron assertion).
