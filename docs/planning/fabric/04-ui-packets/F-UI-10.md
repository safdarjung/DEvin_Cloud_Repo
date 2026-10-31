# F-UI-10 — AI workforce (`/fabric/agents`)

Goal: vision §5 — agent directory, task queue, workflow builder with approval gates (React Flow), run log, risk classes. Nothing executes; the UI shows the control surface.

## Files
- `src/app/(tenant)/[institution]/fabric/agents/page.tsx`: loads `agentDefinitions`, `agentRuns`, `workflows`, `workflowRuns` from `@/modules/fabric/demo/agents`; `?tab=` Directory · Queue · Workflows · Runs.
- `src/modules/fabric/components/agents/directory.tsx` ("use client"): agent cards (name, role, model tier chip local/cloud, max risk class badge with icon, quality score ring, 30-day cost `inr`, error rate, enabled switch → component state + toast "Demo toggle"); click → `agent-sheet.tsx`: tools list, permissions list (real-looking keys), recent runs, "Edit instructions" textarea (component state, "Demo only").
- `agents/risk-badge.tsx`: the 5 `RiskClass` values with icon + text + tooltip definition (verbatim from vision §5.4).
- `agents/queue.tsx`: runs grouped by status; `awaiting_approval` cards show task, risk class, cost, "Approve"/"Reject" (component state → moves card; toast "Recorded in demo"); running cards show a log drawer (`log` lines with level icons).
- `agents/workflow-builder.tsx`: left list of workflows from `useDemoStore(s => s.workflows)`; canvas = `FlowCanvas` (`readOnly={false}`) with `nodeTypes` per `WorkflowNodeType` (trigger/condition/agent/tool/approval/notify/end, each distinct shape + icon); palette to add nodes (click adds at a free position); select node → inspector panel (label, config key/values); connect by drag; "Save" → `saveWorkflow` (bump version); status Active/Paused/Disabled → `setWorkflowStatus`; "Run (demo)" → appends a fake `WorkflowRun` to component state stepping through nodes with 400 ms ticks until the first `approval` node, then stops in `awaiting_approval`.
- `agents/runs.tsx`: timeline per workflow run (`ActivityTimeline` from widgets) with step statuses.

## Controls
Enable switch → local. Approve/Reject → local move. Builder add/connect/edit/save → store. Status → store. Run (demo) → animated local run. Export → JSON of a workflow. "Audit" link → `/fabric/trust?tab=audit`.

## Motion / states / responsive / a11y
Run ticks animate node borders in sequence. Queue cards slide between columns (CSS). Empty queue → `EmptyState`. Mobile: builder shows a read-only canvas + node list editor instead of drag. Every node has an accessible name; palette items are buttons.

## Checks
`pnpm typecheck && pnpm lint && pnpm test -- tests/unit/fabric-fixtures/agents.test.ts tests/unit/fabric-store.test.ts`. Refresh keeps saved workflows.

Commit `feat(ui): F-UI-10 AI workforce — directory, queue, workflow builder, runs`. `DONE F-UI-10 <sha>`.
