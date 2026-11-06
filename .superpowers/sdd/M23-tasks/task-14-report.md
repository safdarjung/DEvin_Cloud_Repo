Packet: M23-T14 Event emission from existing jobs
Files changed: src/modules/workflows/events.ts (new); notify.attendance_absence.ts,
notify.results_published.ts, notify.enquiry_received.ts (one emit line each);
tests/db/workflow-events.test.ts (new)
Behavior implemented: `emitWorkflowEvent(admin, institutionId, event, entityId)`
→ `admin.rpc("emit_workflow_event")`, throws on error (job retries). Each handler
calls it after its own domain check, before recipient early-returns: attendance
after notify_guardian check (entity=session_id); results after
exam.status==="published" (entity=exam_id); enquiry after !enquiry return
(entity=enquiry_id). Notification sending unchanged.
Tests run: TDD red first. `pnpm test:db tests/db/workflow-events.test.ts` → 6
passed (dedupe 2 attendance jobs / 3 result jobs to 1 run, paused/module-off
no-run + notifications unchanged, non-notify status no-emit, enquiry 1 run).
`pnpm test:db tests/db/jobs.test.ts` → 10 passed, 1 failed (C-70 concurrent-claim
count, retried 2x) — pre-existing env flake, other agents' jobs in shared lane
DB claimed too; not from this task (no runner/claim code touched; own test is
institution-scoped + cleaned up).
Tests not run and why: no db:reset/seed/db:types/full test:db (not DB owner).
Limitations / honesty label: n/a — no UI, no AI, deterministic only.
Security / integration risks: none new — straight passthrough to existing
service-role-only `emit_workflow_event` (T3).
Follow-ups: none.
New dependencies: none.
Assumptions: `WorkflowEventKey` reused from schemas.ts/catalog.ts, not redefined.
Lint/typecheck: clean for all 5 touched files.
