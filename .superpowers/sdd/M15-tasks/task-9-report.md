Packet: M15-T9 Job handler `report.generate`
Files changed: src/modules/jobs/handlers/report.generate.ts (new); src/modules/jobs/handlers/index.ts (+generateReport); src/modules/jobs/registry.ts (+JOB_REGISTRY, +JOB_MODULES row scheduled_reports); src/modules/jobs/types.ts (+JobType); tests/db/report-generate-job.test.ts (new)
Behavior implemented: re-reads schedule (missing/paused -> no-op), re-parses params, pulls rows via runReportSource, CSV via rowsToCsvText, >10MB -> throw, uploads to tenant-docs at deterministic path, upserts documents row (onConflict path, ignoreDuplicates) + re-reads by path, notifies active memberships whose role is in recipient_roles (report_ready). Idempotent: same path/doc/notification key on replay.
Tests run: pnpm test:db tests/db/report-generate-job.test.ts tests/db/jobs.test.ts -> 3 passed + 11 passed; pnpm test tests/unit/jobs-runner.test.ts -> 33 passed; pnpm lint -> clean; pnpm typecheck -> clean.
Tests not run and why: db:reset/db:types/full test:db/seed (non-owner rule); other packets' test files.
Limitations / honesty label: n/a (service-role job, no UI).
Security / integration risks: none new — document write still only reachable via service role (0077 restrictive guard); handler never logs job.payload or row contents.
Follow-ups: none.
New dependencies (justification): none.
Assumptions made: schedule.params re-parsed with safeParse -> plain Error("report.generate: invalid_params") on failure (job-handler convention, not ActionResult); file_name slug truncated to 196 chars + ".csv" to respect the 200-char column check; institution timezone resolved the same way as attendance/timetable queries.ts (settings.locale.timezone, fallback Asia/Kolkata).
