Packet: M23-T5 Catalog + Zod schemas

Files changed:
- src/modules/workflows/catalog.ts (new)
- src/modules/workflows/schemas.ts (new)
- tests/unit/workflows-schemas.test.ts (new)

Behavior implemented:
Catalog exports immutable constants for workflow engine: WORKFLOW_ENGINE_VERSION = "workflows_v1", WORKFLOW_EVENTS (3 events: attendance.absences_submitted, results.published, enquiry.received), WorkflowEventKey type, WORKFLOW_METRICS (6 metrics: attendance.session_absences, attendance.repeat_absentees, assignments.missing_due_tomorrow, exams.papers_next_7_days, finance.overdue_invoices, admissions.stale_enquiries), WorkflowMetricKey type, NOTIFY_ROLES (7 values: owner, principal, admin, teacher, accountant, admissions, exam_controller), CONDITION_OPS (5 operators: gt, gte, lt, lte, eq), NODE_MODULE (3 mappings: fee_defaulters → finance_plus, report → scheduled_reports, agent → agents). Schemas exports Zod validators: WorkflowNodeSchema (id regex /^[a-z0-9][a-z0-9_-]{0,39}$/, type in 7 supported + tool, label 1–60, config key-value strings ≤500 chars, optional x/y), GraphEdgeSchema (source/target/label? in true|false|approved|rejected), WorkflowSaveSchema (id? uuid, name 1–80 trimmed, nodes 2–30, edges 1–60), WorkflowStatusSchema, WorkflowRunNowSchema, WorkflowDecideSchema (runId, decision: approve|reject, note ≤500), WorkflowListSchema (status? filter), WorkflowRunsSchema (limit 1–100 default 50), WorkflowRunJobPayloadSchema. All schemas .strict(). Both files export same event/metric/role/operator constants (plain-node safe; schemas has duplication for relative import safety).

Tests run:
- `pnpm test tests/unit/workflows-schemas.test.ts` → 49/49 PASS
- `pnpm lint` → clean
- `pnpm typecheck` → clean

Tests not run and why: None; all required tests pass.

Limitations/honesty: None. All exports match rulings spec exactly.

Security/integration risks: None. Pure Zod schemas and string constants; no I/O, no side effects.

Follow-ups: None.

New dependencies: None.

Assumptions made:
- Duplicate event/metric/role/operator constants in both catalog.ts and schemas.ts; non-seed code prefers catalog (no import path), seed/jobs use schemas (relative .ts safe)
- NODE_MODULE keys match audience types from notify config: fee_defaulters, report scheduledReportId, agent AgentSlug
- All metric modules and event modules resolve to valid ModuleKey values in the type system
