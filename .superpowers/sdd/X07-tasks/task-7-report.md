Packet: X07-T7 Gate pass notification (template + job handler)
Files changed: src/modules/notifications/templates.ts; src/modules/jobs/handlers/notify.gate_pass.ts (new); src/modules/jobs/handlers/index.ts; src/modules/jobs/registry.ts; src/modules/jobs/types.ts; tests/db/notify-gate-pass.test.ts (new)
Behavior implemented: `gate_pass_approved` type/template (en+hi, in_app+sms, category attendance). `notifyGatePass` re-reads gate_passes by payload id; sends only if status approved|exited; recipient = primary guardian's active membership; sms=guardian phone; time=decided_at HH:MM institution tz (fallback Asia/Kolkata); class from active enrolment. Registered in JOB_REGISTRY + JOB_MODULES["notify.gate_pass"]="visitors".
Tests run: `pnpm test:db tests/db/notify-gate-pass.test.ts` -> 4 passed; `pnpm test tests/unit/notification-templates.test.ts tests/unit/jobs-runner.test.ts` -> 40 passed; `pnpm lint` -> clean.
Tests not run and why: none skipped; all ACCEPT commands run.
Limitations / honesty label: sms via simulatedSms (existing badge), no new honesty surface. No exit notification (ruling: approval only).
Security / integration risks: handler re-reads state at send time, never trusts payload beyond gate_pass_id (lesson 11); no PII in audit (no audit call added here — template/handler only).
Follow-ups: none for this task; T10 acceptance test will exercise via real trigger enqueue.
New dependencies (justification): none
Assumptions made: `pnpm typecheck` shows pre-existing errors in src/modules/visitors/actions.ts, gate-pass.actions.ts, tests/db/forecasts-queries.test.ts (T4/T5/forecasts, other agents, untouched by me) — ignored per brief; no errors in my files.
