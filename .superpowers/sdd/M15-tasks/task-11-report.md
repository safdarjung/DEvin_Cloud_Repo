Packet: M15-T11 Report queries
Files changed:
- src/modules/reports/queries.ts (new): reportList, reportRuns, reportExport
- src/modules/reports/query-defs.ts (new): report.list/report.runs/report.export defineQuery wrappers
- src/app/api/v1/query/all-queries.ts (edit): + reports/query-defs import
- tests/db/api-query-route.test.ts (edit): + 3 smoke sample inputs
- tests/db/report-queries.test.ts (new)
Behavior implemented: report.list (report.schedule perm, RLS-filtered by name); report.runs
(document.read, active "report" documents for a schedule, newest first); report.export
(data.export + in-handler source permission check via hasPermission/AppError("forbidden"),
runs the source through the caller's client, returns {rows}; ?format=csv streams via M04's
existing toCsvResponse unwrap-single-array path, no new code needed there).
Tests run: pnpm test:db tests/db/report-queries.test.ts -> 5 passed; pnpm test:db
tests/db/api-query-route.test.ts -> 7 passed; pnpm lint -> 0 errors (1 pre-existing warning
in tests/db/report-generate-job.test.ts, not my file, untouched); pnpm typecheck -> clean.
Tests not run: full test:db / db:reset / db:types (not DB owner for this task); T10's
tests/db/report-actions.test.ts doesn't exist in this tree yet (not a dependency of T11).
Limitations / honesty label: n/a (backend queries only, no UI).
Security / integration risks: report.export's source-permission check lives in the handler,
not a static permission list — covered by the accountant/teacher forbidden tests + the CSV
HTTP test. report.runs relies entirely on 0077's RLS (app.my_report_ids); no app-level
filter beyond institution_id, matching documents.listForEntity's pattern.
Follow-ups: none new.
New dependencies (justification): none.
Assumptions made: T10 (actions.ts) not present yet; fixtures for scheduled_reports/documents
written directly via the service-role client (mirrors tests/db/report-sources-rls.test.ts's
createSchedule helper) instead of going through report.schedule.save.
