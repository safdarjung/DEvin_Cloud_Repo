Packet: M23-T22 Docs

Files changed:
- docs/planning/coolskool/07-security-and-ai-governance.md (added M23 definers row)
- docs/planning/coolskool/05-data-architecture.md (added 2.13 workflows tables, ownership row)
- docs/planning/coolskool/06-workflows-and-contracts.md (added job, events, state machine, metrics)
- docs/planning/coolskool/12-decision-log.md (added D47 ADR, 8 DBT rows)
- docs/planning/fabric/02-architecture.md (changed 0056 → 0096)
- docs/planning/fabric/03-roadmap-and-tracker.md (added FB-INT-07)

Behavior documented: M23 workflows milestone completion. Definers (emit_workflow_event, enqueue_due_workflows, start_workflow_run, decide_workflow_run), metrics (6 SQL counts), tables (workflows, workflow_runs), deviations (D47: SQL metrics, schedule+metric for overdue invoices, agent queue, in-place version), 3 events (attendance.absences_submitted, results.published, enquiry.received), run state machine, 8 debt rows (approvals, module toggle, dedup, audiences, translation, non-blocking agents, catalog version, re-evaluation).

Tests run: none (docs only)

Limitations: honesty label is in the tracker (FB-INT-07 notes `<LimitedBadge>`); no code changes, no DB changes.

Security: complete. Definers documented with role gates, service-role boundaries, no bypass exceptions (workflow_run_update invoker guard). Events gated on module enabled. Metrics institution-scoped. Completeness verified against rulings §4 (definers, job writes).

Follow-ups: UI ships Workstream D later; debt (DBT-125..132) tracks future work (approval TTLs, re-enable resume, audience targeting, translation, etc.).

New dependencies: none

Assumptions made: docs/planning/coolskool/10-backlog-index.md already marked 0096 as "(M23, built)" from prior task state
