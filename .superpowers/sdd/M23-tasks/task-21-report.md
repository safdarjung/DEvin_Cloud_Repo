Packet: M23-T21 Acceptance over HTTP
Files changed: tests/db/workflows-acceptance.test.ts (new)
Behavior: HTTP acceptance test (timetable-acceptance dispatch helpers +
reports-acceptance forced-due/real-runner pattern). Principal saves+activates
event workflow (absence event -> condition gte 1 -> notify principal -> approval
-> agent attendance -> end); teacher marks+submits 1 absent; runner (2x) drives
absence job -> workflow event -> run -> awaiting_approval; workflows.runs +
core.approvals.pending (workflow_run row) confirm. Admin decide -> 403;
principal approve -> 200; runner -> run done, agent_runs queued row, approvals
shows "waiting to start". Disable workflow -> new absence raises no run.
Schedule workflow (finance.overdue_invoices gte 0, notify accountant): forced
due, runner -> one done run, next_run_at = tomorrow 20:00 IST, fires once.
Teacher workflows.list -> 403; admin -> 200.
Tests run: `pnpm test:db tests/db/workflows-acceptance.test.ts` -> 1/1 passed.
`pnpm lint` -> 0 errors (8 pre-existing warnings, not mine). `pnpm typecheck`
-> clean.
Tests not run and why: none skipped.
Limitations / honesty label: none; no UI/simulated surface touched.
Security / integration risks: none; read-only test of T1-T20 surface.
Follow-ups: none new.
New dependencies: none.
Assumptions: alert asserted via `notifications.body` (no `vars` column);
step-4 absence dated yesterday, not tomorrow (mark rejects future dates).
