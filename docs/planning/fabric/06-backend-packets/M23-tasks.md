# M23 — Workflow automation (low-risk)

Source: `07-master-plan-v1-v2.md` §3 M23, §2 D43 (deterministic intelligence first); `02-architecture.md` §4 row 0056. Migration `0096` (claimed 2026-11-02; one file `supabase/migrations/20261028000096_workflows.sql`, written T2 → T3 → T4, each appending one part). The V2 renumbering moved workflows from reserved 0056 to 0096, so the file sorts after every table it reads; plain `language sql` and FKs are fine. No new deps. Module key **`workflows`** (MOD catalog: Intelligence, default off, no `requires`; already in `MODULES` and `app.module_enabled`, so no catalog or SQL module edit). Every definition here declares `module: "workflows"`, except `agent.start` (`"agents"`). Job type `workflow.run` gets the `JOB_MODULES` row `workflows`. No pages or nav items (UI is Workstream D). New owning module `src/modules/workflows` (owns `workflows`, `workflow_runs`). `agents` keeps `agent_runs`; M23 adds its `workflow_run_id` FK, the queue helper and `agent.start`. Replaces fixtures `Workflow` (`workflows()`) and `WorkflowRun` (`workflowRuns()`) in `src/modules/fabric/demo/agents.ts`; query return types equal `src/modules/fabric/types.ts` exactly. CONTRACT (T1, additive): `WorkflowNodeType` gains `"report"`.

**Prereqs merged:** MOD (0084; `module` required; `JOB_MODULES`; runner drops a disabled module's job; test fixtures store all modules on); M08 (0070 `attendance_sessions.period_id`); M09 (0071 `assignment_submissions`); M12 (0074 job `finance.fee_reminder` and its idempotency key); M15 (0077 `app.cron_next_fire`, `CronSchema`/`CRON_SUBSET_PATTERN`, `scheduled_reports`, job `report.generate`, runner sweep port `enqueueDueReports`); M16 (`src/modules/core/approvals.queries.ts`); M22 (0095 `agent_runs` with status `queued` and column `workflow_run_id`, `canDecideRun`, `executeAgentRun`, `agent.run` flow in `src/modules/agents/actions.ts`). M19–M21 are not needed. If M22 is not merged, run the rest and mark T10, T18 (agent branch only), T19 `BLOCKED`; the agent node then always returns `skipped`.

Rulings:
- **Deviations from the master plan (T22 records them as one D-number).**
  1. Conditions read a closed set of **SQL metrics**, not registered queries. A registered query needs a live user's RLS client. `workflow.run` holds only the service role (M15 and M22 rulings).
  2. "Invoice overdue" is a **schedule trigger plus metric `finance.overdue_invoices`**, not an event. No job observes overdue invoices. Emitting from M12's reminder job would loop the fee-reminder workflow.
  3. An **agent node queues** an `agent_runs` row (`queued`) for a person to start with `agent.start` (in-request, as that person, M22 executor). The job never runs a model.
  4. Graph edits bump `version` **in place**; each run stores a snapshot of the graph it runs (02 §4 said "new row").
- **AI boundary (D43, CLAUDE.md rule 6).** M23 makes zero gateway calls. Triggers, conditions, routing, run status and approvals are deterministic code and SQL. The only model work happens later inside M22's `executeAgentRun`, started by a person, bounded by M22's catalog and approval rules. Evidence: each condition step note records the metric, value, operator, threshold and branch (`"finance.overdue_invoices = 12 (gte 1): true"`). Version pin: `workflow_runs.workflow_version` + `graph` snapshot + `engine_version` (`WORKFLOW_ENGINE_VERSION = "workflows_v1"`, written by the handler; a semantic change to the engine means `workflows_v2`). No confidence column: nothing is estimated.
- **Permissions (07 §2.2 rows in T1).** `workflow.read` = owner, principal, admin (queries). `workflow.manage` = owner, principal (save, status, run now, approval decisions). Every other role holds neither. Matches 02 §4 (read owner/principal/admin, write owner/principal), so an admin can never author and approve the same flow.
- **Table `workflows` (0096 part 1).** Columns:
  - `id`; `institution_id → institutions not null`; `name` 1–80 (unique `workflows_institution_id_name_key (institution_id, name)`); `version int not null default 1 check (version >= 1)`.
  - `status text not null default 'draft'` in (`draft`, `active`, `paused`, `disabled`).
  - `trigger_type text not null` in (`schedule`, `event`, `manual`); `trigger_config text not null default ''` ≤ 100. Checks: `(trigger_type = 'manual') = (trigger_config = '')`; `trigger_type <> 'event' or trigger_config in ('attendance.absences_submitted', 'results.published', 'enquiry.received')`; `trigger_type <> 'schedule' or trigger_config ~ <M15 cron regex>` (copy the expanded string of `CRON_SUBSET_PATTERN` from 0077).
  - `nodes jsonb not null` (check `jsonb_typeof = 'array'`, length 2–30, `octet_length(nodes::text) <= 30000`); `edges jsonb not null` (array, length 1–60, `octet_length <= 10000`).
  - `next_run_at timestamptz null`; `created_by → profiles not null`; `created_at`/`updated_at` + `app.set_updated_at()`.
  - Unique `(id, institution_id)` (composite FK target). Partial index `(next_run_at) where status = 'active' and trigger_type = 'schedule'`. Index `(institution_id, trigger_type, trigger_config) where status = 'active'`. No delete path (disable instead; `app.demo_reset` still sweeps by `institution_id`).
- **Table `workflow_runs` (0096 part 1).** Columns:
  - `id`; `institution_id`; `workflow_id` with composite FK `(workflow_id, institution_id) → workflows (id, institution_id)` (lesson 2 at schema level).
  - `workflow_version int not null check (>= 1)`; `engine_version text null` ≤ 20; `graph jsonb not null` (object with keys `nodes`, `edges`, copied from the workflow at run creation).
  - `trigger_kind text not null` in (`schedule`, `event`, `manual`); `trigger_key text not null` 1–200, unique `workflow_runs_workflow_trigger_key (workflow_id, trigger_key)`; `entity_id uuid null` (event subject); `requested_by → profiles null` (manual runs).
  - `status text not null default 'running'` in (`running`, `awaiting_approval`, `done`, `failed`). The fixture's `paused` is never written.
  - `started_at timestamptz not null default now()`; `finished_at`; `steps jsonb not null default '[]'` (array, length ≤ 100).
  - `cursor_node_id text null` ≤ 40; `pending_decision text null` in (`approved`, `rejected`); `last_value int null`.
  - `decided_by → profiles null`; `decided_at`; `decision_note` ≤ 500 null; `created_at`/`updated_at` + trigger.
  - Checks: `(status in ('done','failed')) = (finished_at is not null)`; `status <> 'awaiting_approval' or cursor_node_id is not null`; `pending_decision is null or status = 'running'`.
  - Unique `(id, institution_id)`. Indexes `(institution_id, created_at desc)`, `(workflow_id, created_at desc)`, partial `(institution_id) where status = 'awaiting_approval'`, partial `(updated_at) where status = 'running'`.
- **`agent_runs` additions (0096 part 1).** `alter table public.agent_runs add constraint agent_runs_workflow_run_fk foreign key (workflow_run_id, institution_id) references public.workflow_runs (id, institution_id)` (M22 left `workflow_run_id` without FK for M23). Partial unique index `agent_runs_workflow_agent_key (workflow_run_id, agent_id) where workflow_run_id is not null` (queueing is idempotent).
- **RLS + grants (07 §2.2, lessons 1/2/7).** initPlan form only: `institution_id = any((select app.my_institution_ids(array[...])))`.
  - `workflows`: SELECT owner/principal/admin; INSERT `with check` owner/principal; UPDATE `using` + `with check` owner/principal; no DELETE policy. Grants: revoke all from anon, authenticated; authenticated `select, insert, update`; service_role `select, insert, update`.
  - `workflow_runs`: SELECT owner/principal/admin; no INSERT/UPDATE/DELETE policy (definers and the service-role handler write). Grants: revoke all from anon, authenticated; authenticated `select`; service_role `select, insert, update`.
  - Teacher, accountant, admissions, exam_controller, guardian, student: nothing.
- **Guard `app.guard_workflow_write()`** (BEFORE INSERT OR UPDATE on `workflows`; mirror M15 `app.scheduled_reports_before_write`: security definer, `search_path = ''`, execute revoked from public). Trusted = `nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role'` or `session_user = 'postgres'` (lesson 5).
  - INSERT, non-trusted: `status <> 'draft'` → `code:invalid_state`; `version := 1`; `created_by := app.current_user_id()`.
  - UPDATE, non-trusted: change of `institution_id`, `created_by` or `created_at` → `code:forbidden`. Graph change = any of `nodes`, `edges`, `trigger_type`, `trigger_config` distinct from old. A graph change needs `old.status in ('draft','paused')`, else `code:invalid_state`; then `version := old.version + 1`. Otherwise `version := old.version`. A name-only change is allowed in every status.
  - Status transitions (any caller): `draft→active`, `draft→disabled`, `active→paused`, `active→disabled`, `paused→active`, `paused→disabled`, `disabled→draft`, or unchanged. Anything else → `code:invalid_state`.
  - `next_run_at` (any caller): on INSERT, or when `status`, `trigger_type` or `trigger_config` changes, set `case when new.status = 'active' and new.trigger_type = 'schedule' then app.cron_next_fire(new.trigger_config, tz, now()) end`, with `tz = coalesce(institutions.settings->'locale'->>'timezone', 'Asia/Kolkata')`. Active schedule with a null result → `code:validation_failed` (`detail 'cron never fires'`). Any other UPDATE: non-trusted keeps `old.next_run_at` (users cannot force a run); trusted (the sweep) keeps its own value.
- **Guard `app.guard_workflow_run_update()`** (BEFORE UPDATE on `workflow_runs`, security invoker, `search_path = ''`, **no bypass**: only definers and the service role write, same as M22's agent-run guard).
  - `old.status in ('done','failed')` → `code:invalid_state`.
  - Immutable: `institution_id, workflow_id, workflow_version, graph, trigger_kind, trigger_key, entity_id, requested_by, started_at, created_at` → `code:invalid_state`.
  - Allowed: `running → awaiting_approval | done | failed`; `awaiting_approval → running` only with `pending_decision`, `decided_by` and `decided_at` not null. Anything else (same-status updates included) → `code:invalid_state`.
- **Run lifecycle (0096 part 2).** All plpgsql, `security definer`, `search_path = ''`, qualified names, no dynamic SQL (lesson 4). Payloads are built in SQL from rows (lesson 3).
  - `app.create_workflow_run(p_workflow_id uuid, p_trigger_kind text, p_trigger_key text, p_entity_id uuid, p_requested_by uuid) returns uuid`. Reads the workflow. Inserts a run (`status 'running'`, `workflow_version = w.version`, `graph = jsonb_build_object('nodes', w.nodes, 'edges', w.edges)`) `on conflict (workflow_id, trigger_key) do nothing`. When a row was inserted, it calls `app.enqueue_job(w.institution_id, 'workflow.run', jsonb_build_object('run_id', id), 'workflow.run:' || id || ':start')`. Returns the new id, or null on conflict. Execute revoked from everyone; only the definers below call it.
  - `public.emit_workflow_event(p_institution_id uuid, p_event text, p_entity_id uuid) returns int` (execute: service_role only). Event not one of the 3 keys, or null entity → `code:validation_failed`. `not app.module_enabled(p_institution_id, 'workflows')` → 0. For each `active` workflow of the institution with `trigger_type = 'event' and trigger_config = p_event`: `app.create_workflow_run(w.id, 'event', 'event:' || p_event || ':' || p_entity_id, p_entity_id, null)`. Returns the number of runs created.
  - `public.enqueue_due_workflows() returns int` (execute: service_role only). Mirror M15 `enqueue_due_reports`:
    - For up to 200 workflows `status = 'active' and trigger_type = 'schedule' and next_run_at <= now() and app.module_enabled(institution_id, 'workflows')`, locked `for update skip locked`: create a run with key `'schedule:' || to_char(next_run_at at time zone 'UTC', 'YYYYMMDD"T"HH24MI"Z"')`, then set `next_run_at = app.cron_next_fire(trigger_config, tz, greatest(next_run_at, now()))`. Missed windows are skipped (at most one late run). Module off → row untouched.
    - **Reaper:** runs with `status = 'running' and updated_at < now() - interval '6 hours'` → `failed`, `finished_at = now()`, `cursor_node_id`/`pending_decision` null, append step `{node_id: "_run", status: "failed", at: now(), note: "Stopped: no progress for 6 hours"}`. Job backoff totals about 30 minutes (0003: 2^n minutes, 5 attempts), so 6 hours means the job is gone (dropped by MOD or dead).
    - Returns the number of runs created.
  - `public.start_workflow_run(p_workflow_id uuid) returns uuid` (execute: authenticated). No uid → `code:unauthenticated`. Workflow missing, or caller not owner/principal/admin of its institution → `code:not_found`. Caller not owner/principal → `code:forbidden`. `workflows` module off → `code:forbidden`. Status not `active`, or `trigger_type = 'event'` (event flows need a subject) → `code:invalid_state`. Key `'manual:' || to_char(now() at time zone 'UTC', 'YYYYMMDD"T"HH24MI')`, `requested_by` = caller. On conflict (same minute) it returns the existing run id for that key (idempotent click). Audits `workflow.run.started` `{run_id, workflow_id}`.
  - `public.decide_workflow_run(p_run_id uuid, p_decision text, p_note text default null) returns public.workflow_runs` (execute: authenticated). No uid → `unauthenticated`. Run missing or caller not owner/principal/admin of its institution → `not_found`. Caller not owner/principal → `forbidden`. Module off → `forbidden`. Decision not `approve|reject`, or note > 500 → `validation_failed`. `select … for update`; status not `awaiting_approval` → `invalid_state` (a second concurrent decision waits, then fails here). Sets `status 'running'`, `pending_decision` (`approved|rejected`), `decided_by = caller`, `decided_at = now()`, `decision_note`. Enqueues `workflow.run` `{run_id}` with key `'workflow.run:' || id || ':' || cursor_node_id` (a DAG visits each node once, so the key is unique). Audits `workflow.run.approved|rejected` `{run_id, node_id}`.
  - `public.*` execute revoked from public and anon; granted as stated. `app.*` revoked from everyone.
- **Events.** Closed set: `attendance.absences_submitted` (subject: attendance session; module `attendance`), `results.published` (subject: exam; module `exams`), `enquiry.received` (subject: enquiry; module `admissions`). Emitted by `emitWorkflowEvent(admin, institutionId, event, entityId): Promise<number>` in `src/modules/workflows/events.ts` (plain-node safe; `admin.rpc("emit_workflow_event")`; error → throw, so the job retries and the event is at-least-once). Emission points (after each handler's domain checks, before its recipient early-returns):
  - `notify.attendance_absence`: after `if (!statusConfig?.notify_guardian) return;` → `("attendance.absences_submitted", record.session_id)`. Only sessions with at least one guardian-notified absence emit. Many absence jobs of one session create one run (unique trigger key).
  - `notify.results_published`: after `if (exam.status !== "published") return;` → `("results.published", result.exam_id)`. One run per exam.
  - `notify.enquiry_received`: after `if (!enquiry) return;` → `("enquiry.received", enquiry.id)` (add `institution_id` to its select if missing).
  - A job dropped by MOD (its module off) emits nothing: module off = feature off.
- **Metrics (0096 part 3).** `public.workflow_metric(p_institution_id uuid, p_metric text, p_entity_id uuid, p_as_of timestamptz) returns int`: plpgsql, `stable security invoker`, `search_path = ''`, execute to service_role only (M15 precedent: the institution filter in the body is the only filter). `tz` as above; `d = (p_as_of at time zone tz)::date`. Notify codes = attendance status codes whose `settings.attendance.statuses[].notify_guardian` is true (same jsonb path as 0014). Unknown metric, or a subject metric with null entity → `code:validation_failed`. An entity of another institution counts 0.

  | key | module | subject (event) | integer returned |
  |---|---|---|---|
  | `attendance.session_absences` | attendance | `attendance.absences_submitted` | records of session `p_entity_id` (same institution) whose status is a notify code |
  | `attendance.repeat_absentees` | attendance | `attendance.absences_submitted` | `last3` = up to 3 sessions of that session's section with `period_id is null`, `status = 'submitted'`, `date <= session date`, newest first. Fewer than 3 → 0. Else the number of students with a notify-code record in all 3 |
  | `assignments.missing_due_tomorrow` | assignments | — | pairs (assignment `status = 'published'` and `(due_at at time zone tz)::date = d + 1`, enrolment `status = 'active'` in its `class_section_id`) with no `assignment_submissions` row for (assignment, student) |
  | `exams.papers_next_7_days` | exams | — | `exam_papers` whose exam `status <> 'published'` and `held_on between d + 1 and d + 7` |
  | `finance.overdue_invoices` | fees | — | invoices `status in ('issued','part_paid')`, `due_on < d`, `total - paid_total > 0` (M12's reminder predicate) |
  | `admissions.stale_enquiries` | admissions | — | enquiries `status = 'new'` and `created_at < p_as_of - interval '48 hours'` |
- **Graph rules (`src/modules/workflows/graph.ts`, pure).** `parseGraph(input: { nodes: unknown; edges: unknown }): { ok: true; graph: ParsedGraph } | { ok: false; errors: string[] }`. Errors are plain strings like `"node c1: unknown metric"`, at most 20. `WorkflowNode.config` is `Record<string, string>`, so numbers and lists arrive as strings.
  1. Structure: Zod `WorkflowNodeSchema`/`GraphEdgeSchema` from `schemas.ts`. Nodes 2–30; edges 1–60. Node `id` matches `^[a-z0-9][a-z0-9_-]{0,39}$`, unique. `label` 1–60. Config values ≤ 500 chars. `x`, `y` optional finite numbers. Edge `source`/`target` exist; no self-loop; no duplicate `(source, target, label)`.
  2. Types: `trigger`, `condition`, `notify`, `report`, `agent`, `approval`, `end`. `tool` → `"node <id>: node type tool is not supported"`.
  3. Config per type (strict keys; unknown key → error):
     - `trigger` `{kind: schedule|event|manual, cron?, event?}`: `schedule` needs `cron` passing M15 `CronSchema`; `event` needs `event` in the 3 keys; `manual` has neither.
     - `condition` `{metric, op: gt|gte|lt|lte|eq, value: ^[0-9]{1,6}$}`. A metric with a subject requires the trigger to be that event.
     - `notify` `{audience: roles|fee_defaulters, roles?, message?}`. `roles` → `roles` = comma list, 1–7 unique values in `NOTIFY_ROLES` (`owner, principal, admin, teacher, accountant, admissions, exam_controller`), and `message` 1–200 (one placeholder `{count}` allowed). `fee_defaulters` → neither key, and the node must be **behind an approval**: BFS from the trigger that never follows an approval node's `approved` edge must not reach it (`"node <id>: family reminders need an approval first"`).
     - `report` `{scheduledReportId: uuid}`.
     - `agent` `{agent: AgentSlug (M22 AGENT_SLUGS), task: 1–500}`. At most one agent node per slug (queue key).
     - `approval` `{prompt: 1–120}`.
     - `end` `{}`.
  4. Exactly one `trigger`, with no incoming edge.
  5. Out-edges: `trigger`, `notify`, `report`, `agent` → exactly one, unlabelled. `condition` → `true` (required) and `false` (optional), nothing else. `approval` → `approved` (required) and `rejected` (optional). `end` → none.
  6. Acyclic; every node reachable from the trigger; at least one `end`.
  - Also exports `triggerColumns(graph: ParsedGraph): { trigger_type; trigger_config }` (schedule → cron, event → key, manual → `''`), used by `workflow.save` and the seed.
  - Imports (relative `.ts` only, runner- and seed-safe): `./schemas.ts`, `./catalog.ts`, `../reports/schemas.ts` (`CronSchema`), `../agents/catalog.ts` (`AGENT_SLUGS`), `../../lib/modules/catalog.ts` (types).
- **Engine (`src/modules/workflows/engine.ts`, pure: no IO; IO only through injected ports; no `Date.now()`).** Mirrors the `runOnceCore` + `RunnerPorts` pattern.
  - Types: `NodeOutcome = { status: "done" | "skipped"; note: string }`; `EnginePorts = { moduleOn(key: ModuleKey): boolean; metric(key: WorkflowMetricKey): Promise<number>; notify(cfg: NotifyConfig, message: string): Promise<NodeOutcome>; report(cfg: ReportConfig): Promise<NodeOutcome>; agent(cfg: AgentConfig): Promise<NodeOutcome>; now(): string }`; `EngineStart = { kind: "trigger" } | { kind: "resume"; nodeId: string; decision: "approved" | "rejected"; lastValue: number | null }`; `EngineResult = { status: "done" | "failed" | "awaiting_approval"; steps: WorkflowRun["steps"]; cursorNodeId: string | null; lastValue: number | null }`.
  - `runWorkflow(graph: ParsedGraph, start: EngineStart, ports: EnginePorts): Promise<EngineResult>` never throws. It walks one path, with no parallel branches. Each visited node appends `{ node_id, status, at: ports.now(), note }`; notes ≤ 200 chars and hold labels, counts and codes only, never names.
  - `trigger` → `done`, follow its edge.
  - `condition`: metric module off → `skipped` (`"Module off: <key>"`), take `false`. Else `v = await ports.metric(metric)`; `lastValue = v`; branch `v <op> value`; note as in the AI boundary ruling. Missing `false` edge → run `done`.
  - `notify` / `report` / `agent`: module (`notify` roles → none (core); `notify` fee_defaulters → `finance_plus`; `report` → `scheduled_reports`; `agent` → `agents`) off → `skipped`. Else call the port and record its outcome. `notify` message = `message.replaceAll("{count}", String(lastValue ?? 0))`. Follow the edge.
  - `approval` on first reach → step `running` (note = prompt), return `awaiting_approval` with `cursorNodeId` = node id. On `resume` the walk starts at that node: step `done`, note `Approved`/`Rejected`, follow `approved`/`rejected`. A missing `rejected` edge → run `done`.
  - `end` → `done`, run `done`.
  - A port throw → that step `failed`, note `Failed: <error message, ≤ 60 chars>`, run `failed`, stop. More than 100 steps → `failed` (defensive; a DAG cannot hit it).
  - The last step entry per node wins (an approval node has `running` then `done`).
- **Ports (`src/modules/workflows/ports.ts`, plain-node safe).** `createEnginePorts(admin, run: { id; institution_id; entity_id }, workflow: { name; created_by }, settings: Record<string, unknown>, now: () => Date): EnginePorts`. Port errors throw `Error("<code>")` with codes `metric_failed | notify_failed | report_failed | agent_failed`; never raw SQL text (lesson 10).
  - `moduleOn` = MOD `isModuleEnabled({ institution: { settings } }, key)`.
  - `metric` = `admin.rpc("workflow_metric", { p_institution_id, p_metric, p_entity_id: run.entity_id, p_as_of: now().toISOString() })`.
  - `notify` audience `roles`: memberships of the institution with `status = 'active'` and `role` in the list (lesson 11), paged `.range()` by 500. For each: `createNotification(admin, { institutionId, recipientUserId, type: "workflow_alert", entityId: \`${run.id}:${nodeId}\`, vars: { workflow: name, message } })` (idempotent on type + entity + recipient). Zero recipients → `skipped` "No recipients". Else `done` "Notified <n>".
  - `notify` audience `fee_defaulters`: local date `d` (`Intl.DateTimeFormat("en-CA", { timeZone: tz })`); current term = `terms` of the institution with `starts_on <= d <= ends_on`, newest `starts_on`. None → `skipped` "No current term". Else upsert a `jobs` row `{ institution_id, type: "finance.fee_reminder", payload: { term_id, as_of: d }, idempotency_key: <M12's exact key text from 0074 enqueue_fee_reminders> }` (`onConflict: "idempotency_key", ignoreDuplicates: true`). The payload is built from the verified term row. So a day's manual send and workflow send dedupe, and M12's handler re-checks state at send. Result: `done` "Fee reminders queued".
  - `report`: `scheduled_reports` row by id **and** `institution_id`. Missing or `paused` → `skipped` "Report missing or paused". Else upsert a `jobs` row `{ type: "report.generate", payload: { scheduled_report_id, fire_at: now ISO }, idempotency_key: \`report.generate:${id}:wf:${run.id}:${nodeId}\` }` → `done` "Report queued".
  - `agent`: `queueWorkflowAgentRun(admin, { institutionId, slug, task, requestedBy: workflow.created_by, workflowRunId: run.id })`. `disabled` → `skipped` "Agent turned off". Else `done` "Agent run queued".
- **Agent queue (`src/modules/agents/queue.ts`, agents-owned, plain-node safe).** `queueWorkflowAgentRun(admin, input): Promise<{ status: "queued"; runId: string; created: boolean } | { status: "disabled" }>`. Steps:
  1. Slug not in `AGENT_SLUGS` → throw `invalid_agent`.
  2. Upsert the 6 definition rows `(institution_id, slug)` `on conflict do nothing` (same semantics as M22 `ensureAgentDefinitions`, which is not plain-node safe; comment `// shortcut: duplicates ensureAgentDefinitions' upsert because the runner cannot import @/; merge when service-role.ts becomes plain-node safe`).
  3. Read the slug's definition; `is_enabled = false` → `disabled`.
  4. Insert `agent_runs` `{ institution_id, agent_id, workflow_run_id, task, requested_by, status: "queued", risk_class: "read_only", catalog_version: AGENT_CATALOG_VERSION }` with `on conflict (workflow_run_id, agent_id) do nothing`, then read back by `(workflow_run_id, agent_id)`.
  - The workflow does not wait for the agent run.
- **`agent.start` (agents module).** Starts a queued run in-request as the caller. Permission `agent.run`, module `agents`. Steps:
  1. Read the run (user client) → `not_found`.
  2. Status not `queued` → `invalid_state`.
  3. `!canDecideRun({ userId, canApprove: hasPermission(ctx, "agent.approve") }, { risk_class: "user_confirmed", requested_by })` → `forbidden`.
  4. Definition disabled → `invalid_state` "This agent is turned off."
  5. Claim with a service-role conditional update `queued → running` (`started_at = now()`) `where status = 'queued'`. 0 rows → `conflict` "This run was already started."
  6. Continue exactly like `agent.run` after its insert. Extract that tail of `runAgent` into a local `finishRun(ctx, runId, slug, task)` in the same file; no behaviour change for `agent.run`.
  - Audit `agent.start` `{ runId, slug, status }` (never the task).
- **Handler `workflow.run` (`src/modules/jobs/handlers/workflow.run.ts`, relative `.ts` imports).** Payload `{ run_id }` (`WorkflowRunJobPayloadSchema`, strict; bad → throw `invalid_payload`). Steps:
  1. Read the run by `id` and `institution_id = job.institution_id` (admin). Missing, or status not `running` → return (idempotent; lesson 11).
  2. Read the institution `settings` and the workflow `name, created_by`. `workflows` module off → return.
  3. `parseGraph(run.graph)` fails → update to `failed` with step `{ node_id: "_run", status: "failed", note: "Invalid workflow graph" }` and return.
  4. `start` = `pending_decision` set → `resume` (`cursor_node_id`, decision, `last_value`); else `trigger`.
  5. `runWorkflow` with `createEnginePorts`.
  6. Update `status`, `steps = [...run.steps, ...result.steps]`, `cursor_node_id`, `last_value`, `pending_decision: null`, `engine_version`, `finished_at` (now when done/failed) — `.eq("status", "running")`. 0 rows → return.
  - One write at the end: a crashed attempt re-runs from its start. That is safe because every side effect is idempotent (notification key, job keys, agent unique). Re-evaluated conditions may differ; that is accepted.
  - Registries: `JobType` + `"workflow.run"`, `JOB_REGISTRY`, `JOB_MODULES["workflow.run"] = "workflows"`, `handlers/index.ts`.
- **Sweep port.** `RunnerPorts.enqueueDueWorkflows(): Promise<number>` = `admin.rpc("enqueue_due_workflows")`, throws on error. `runOnceCore` calls it once before the claim loop, after the last existing sweep call, in its own try/catch. Error → log `[<cid>] workflows sweep failed` and continue. Cadence = runner cadence (hosted pg_cron every 5 min).
- **Approvals union (M16 file, two branches).**
  - New `workflow_run` block after the existing ones. Skipped unless `workflow.manage` AND `isModuleEnabled(ctx, "workflows")`. Rows = `awaiting_approval` runs (RLS), oldest `updated_at` first: `{ id, kind: "workflow_run", title: "<workflow name>: <prompt of cursor node from the graph snapshot>"` cut to 120 chars, `requestedBy: "Automation", age }`.
  - M22's `agent_run` block also lists `queued` runs the caller `canDecideRun` with `risk_class: "user_confirmed"`: title `"<Agent name>: workflow task waiting to start"`. Never the task text.
- **Actions** (`src/modules/workflows/actions.ts`, `"use server"`, `module: "workflows"`, user client, RLS):
  - `workflow.save` (`workflow.manage`) `{ id?, name, nodes, edges }`. `parseGraph` fails → `validation_failed` with `fieldErrors.graph = errors`. Derive trigger columns with `triggerColumns`. Insert (draft) or update by id (0 rows → `not_found`). Guard `code:invalid_state` → `invalid_state` "Pause the workflow to edit it." `23505` on `workflows_institution_id_name_key` → `conflict` + `fieldErrors.name`. Audit `workflow.saved` `{ id, version }`. Returns `{ id, version, status }`.
  - `workflow.setStatus` (`workflow.manage`) `{ id, status }`. Read the row → `not_found`. Target `active` → re-run `parseGraph` (fail → `validation_failed`). Update; guard codes map (`invalid_state`; `validation_failed` "This schedule never fires."). Audit `workflow.status` `{ id, from, to }`. Returns `{ id, status, nextRunAt }`.
  - `workflow.runNow` (`workflow.manage`) `{ id }` → `rpc("start_workflow_run")` → `{ runId }`.
  - `workflow.run.decide` (`workflow.manage`) `{ runId, decision: "approve" | "reject", note? }` → `rpc("decide_workflow_run")` → `{ runId, status: "running" }`.
  - All errors through `mapSqlError`/`throwMapped` (`42501` → `forbidden`); never raw SQL text.
- **Queries** (`src/modules/workflows/queries.ts` + `query-defs.ts`, `workflow.read`, `module: "workflows"`, user client; no fixture imports):
  - `workflows.list` `{ status? }` → `Workflow[]` by name. `trigger = { type: trigger_type, config: trigger_config }`; `created_by` = creator's full name (mirror `core.audit.list`'s actor-name lookup; `""` if unreadable).
  - `workflows.runs` `{ workflowId?, status?, limit 1–100 default 50 }` → `WorkflowRun[]`, newest `created_at` first. Columns as named; `steps` as stored; a `node_id` of `"_run"` marks a run-level step.
  - The output carries exactly the fixture keys (unit-asserted).
- **Seeded workflows** (`src/modules/workflows/templates.ts`, `WORKFLOW_TEMPLATES: readonly { key; name; nodes: WorkflowNode[]; edges: GraphEdge[] }[]`; seed section `workflows` inserts all 5 as `active`, `created_by` = demo principal). Layout: `x = column × 220`; `y = 0`, false/rejected targets `y = 140`. Node ids as given:
  1. `absence_follow_up` "Absence follow-up": `t` trigger `{kind:"event", event:"attendance.absences_submitted"}` → `c` condition `{metric:"attendance.repeat_absentees", op:"gte", value:"1"}` →true `n` notify `{audience:"roles", roles:"principal,admin", message:"{count} student(s) in this class have been absent 3 school days running. Please call their families."}` → `e` end; `c` →false `e`.
  2. `assignment_reminder` "Assignment reminder": `t` schedule `0 16 * * 1-6` → `c` `assignments.missing_due_tomorrow` gte 1 →true `n` roles `teacher`, "School-wide, {count} submission(s) are still missing for assignments due tomorrow. Remind your classes." → `e`; `c` →false `e`.
  3. `exam_reminder` "Exam reminder": `t` schedule `0 8 * * 1` → `c` `exams.papers_next_7_days` gte 1 →true `n` roles `teacher,exam_controller`, "{count} exam paper(s) are scheduled in the next 7 days. Check rooms and invigilation." → `e`; `c` →false `e`.
  4. `fee_reminder` "Fee reminder": `t` schedule `0 9 * * 1` → `c` `finance.overdue_invoices` gte 1 →true `n1` roles `accountant,principal`, "{count} invoice(s) are overdue. A principal can approve sending reminders to families." → `a` approval `{prompt:"Send fee reminders to families with overdue invoices?"}` →approved `n2` notify `{audience:"fee_defaulters"}` → `e`; `a` →rejected `e`; `c` →false `e`.
  5. `admissions_follow_up` "Admissions follow-up": `t` schedule `0 10 * * 1-6` → `c` `admissions.stale_enquiries` gte 1 →true `n` roles `admissions,principal`, "{count} admission enquiries have had no follow-up for 2 days." → `g` agent `{agent:"admissions", task:"Review admission enquiries that are still new after 2 days and propose a short follow-up note for each."}` → `e`; `c` →false `e`.
  - No guardian or student is ever contacted without a person approving (only `fee_reminder` reaches families, through M12's job).
- **Notification template `workflow_alert`.** Channels `["in_app"]`; category `announcement` (no new category; in-app is never preference-filtered). Vars `{ workflow: 1–80, message: 1–300 }` strict. EN title `Workflow alert`, HI `वर्कफ़्लो अलर्ट`. Body (both languages) `{workflow}: {message}`. The authored message is not translated (debt).
- **ErrorCode map:** `unauthenticated` · `forbidden` (permission; module off; `42501`; `code:forbidden`) · `not_found` (0 rows; `code:not_found`) · `validation_failed` (Zod; `parseGraph`; `code:validation_failed`) · `conflict` (`23505` name; `agent.start` claim lost) · `invalid_state` (graph edit while active; illegal transition; decide on a non-waiting run; run now on an inactive or event workflow). Audit metadata = ids, versions and statuses only; never messages, prompts or task text.
- **Honesty (UI later, T22 records):** `<LimitedBadge>` "Low-risk automation: in-app alerts, reports, queued agent tasks; family reminders need approval". `workflow_alert` is in-app only. Fee reminders inherit M12's channel badges.

Routing: T1 haiku none [] ; T2 sonnet exclusive [] ; T3 sonnet exclusive [2] ; T4 sonnet exclusive [3] ; T5 haiku none [1] ; T6 haiku none [] ; T7 sonnet none [5] ; T8 opus none [7] ; T9 haiku none [7] ; T10 sonnet tests [2] ; T11 sonnet tests [4,6,8,10] ; T12 sonnet tests [3,11] ; T13 sonnet none [3] ; T14 sonnet tests [3,5] ; T15 sonnet tests [1,2,5,7] ; T16 sonnet tests [3,15] ; T17 sonnet tests [1,2,5] ; T18 sonnet tests [1,2] ; T19 sonnet tests [] ; T20 sonnet exclusive [2,9] ; T21 sonnet tests [12,13,14,16,17,18,19,20] ; T22 haiku none [21]

Every new action: manifest import in `src/app/api/v1/actions/all-actions.ts` (new file `workflows/actions.ts`; `agents/actions.ts` is already listed) + C-03 fixture in `tests/security/escalation.test.ts`. Every new query: `src/modules/workflows/query-defs.ts` + `all-queries.ts` line + smoke sample in `tests/db/api-query-route.test.ts`. `tests/security/module-gate.test.ts` covers every new name automatically. Files the runner or seed load (`catalog.ts`, `schemas.ts`, `graph.ts`, `engine.ts`, `ports.ts`, `events.ts`, `templates.ts`, `agents/queue.ts`, the handler): relative `.ts` value imports only; `import type` may use `@/`. Single-file db runs: `pnpm test:db tests/db/x.test.ts` (no `--`). Shared files (`permissions.ts`, `07 §2.2`, `types.ts`, `templates.ts` (notifications), jobs registries, `runner.ts`, `approvals.queries.ts`, `agents/actions.ts`, `all-actions.ts`, `all-queries.ts`, `escalation.test.ts`, `api-query-route.test.ts`, seed `index.ts`): **Edit only, never Write**. Review (Sonnet security) after T3, T11, T12, T15, T16, T19.

---

### Task 1: M23-T1 Permissions + CONTRACT `"report"` (Haiku)
READ: BRIEF-COMMON.md; rulings (Permissions); `src/lib/auth/permissions.ts`; `docs/planning/coolskool/07-security-and-ai-governance.md` §2.2; `src/modules/fabric/types.ts` (0056 block)
FILES: `src/lib/auth/permissions.ts`; `tests/unit/permissions.test.ts`; `07-security-and-ai-governance.md` §2.2 (two rows); `src/modules/fabric/types.ts` (one union member; commit message prefix `CONTRACT:`)
MIGRATION: none
EXPORTS: `Permission` gains `"workflow.read" | "workflow.manage"` with grants per rulings; `WorkflowNodeType` gains `"report"` (additive; `"tool"` stays for fixture compatibility).
TEST FIRST: owner/principal/admin hold `workflow.read`; only owner/principal hold `workflow.manage`; teacher, accountant, admissions, exam_controller, guardian, student hold neither; matrix snapshot equals 07 §2.2.
ACCEPT: `pnpm test tests/unit/permissions.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 2: M23-T2 Migration 0096 part 1 — tables, RLS, guards, `agent_runs` FK (Sonnet, DB owner)
READ: BRIEF-COMMON.md (lessons 1–7); rulings (Tables, `agent_runs` additions, RLS + grants, both guards); `supabase/migrations/20261028000077_scheduled_reports.sql` (write guard, cron regex, tz lookup); `…0095_agents.sql` (agent-run guard, composite FK, grants); `…0069_timetable.sql` (initPlan RLS)
FILES: `supabase/migrations/20261028000096_workflows.sql` (new); `tests/db/workflows-rls.test.ts` (new); `src/lib/db/types.ts` (regen); `tests/security/rls-expectations.ts` / `grants.test.ts` only if the suite demands (say so)
MIGRATION: `20261028000096_workflows.sql` (claimed)
EXPORTS: `workflows`, `workflow_runs`, checks, uniques, indexes, RLS, grants, `app.guard_workflow_write`, `app.guard_workflow_run_update`, `agent_runs_workflow_run_fk`, `agent_runs_workflow_agent_key` — exactly per rulings.
TEST FIRST (fixture institutions A and B): principal inserts a draft → version 1, `created_by` = principal; principal inserts `active` → `invalid_state`; admin insert → 42501; admin select sees A's rows; teacher, accountant, guardian select → []; graph update while active → `invalid_state`; while paused → version + 1; name-only update while active → version unchanged; `draft→paused` → `invalid_state`; activating schedule `0 8 31 2 *` → `validation_failed`; activating `0 20 * * *` → `next_run_at` set; principal `update next_run_at` → unchanged; `created_by` or `institution_id` change → `forbidden`; event trigger `foo.bar` → 23514; manual with non-empty config → 23514; 31 nodes → 23514. Runs (service-role inserts): owner of B sees none of A's; principal insert/update → 42501; `running→done` with `finished_at` ok; `done→running` → `invalid_state`; `awaiting_approval→running` without `pending_decision` → `invalid_state`; `graph` update → `invalid_state`; run with A's institution and B's workflow → 23503; duplicate `(workflow_id, trigger_key)` → 23505; `agent_runs` row pointing at B's run from A → 23503; duplicate `(workflow_run_id, agent_id)` → 23505.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/workflows-rls.test.ts`; `pnpm test:security tests/security/grants.test.ts tests/security/rls-generated.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 3: M23-T3 Migration 0096 part 2 — run lifecycle definers (Sonnet, DB owner)
READ: BRIEF-COMMON.md (lessons 3–5, 10); rulings (Run lifecycle); T2 part; `…0077_scheduled_reports.sql` (`enqueue_due_reports`); `…0070_staffing.sql` (definer + audit pattern)
FILES: `supabase/migrations/20261028000096_workflows.sql` (append part 2); `tests/db/workflows-lifecycle.test.ts` (new); `src/lib/db/types.ts` (regen)
MIGRATION: `20261028000096_workflows.sql` (part 2)
EXPORTS: `app.create_workflow_run`, `public.emit_workflow_event`, `public.enqueue_due_workflows`, `public.start_workflow_run`, `public.decide_workflow_run`, with grants per rulings.
TEST FIRST: emit for an active event workflow → 1 run (`running`, graph snapshot equals the workflow, `workflow_version` copied) + one `workflow.run` job with payload exactly `{run_id}` and key `workflow.run:<id>:start`; same emit again → 0, still one run; paused workflow → 0; `workflows` off → 0; unknown event → `validation_failed`; authenticated principal calling emit → permission denied. Sweep: due schedule → 1 run + job, `next_run_at` in the future; second call → 0; overdue 3 days → one run; module off → 0 and `next_run_at` unchanged; a `running` run with `updated_at` 7 h ago → `failed` with a `_run` step; 1 h ago → untouched. `start_workflow_run`: principal → run id, `requested_by` set, audit row; same minute → same id; admin → `forbidden`; B's principal → `not_found`; event workflow → `invalid_state`; paused → `invalid_state`. `decide_workflow_run` on an awaiting run (inserted by service role with `cursor_node_id`): principal approve → `running`, `pending_decision 'approved'`, job key `workflow.run:<id>:<node>`; again → `invalid_state`; admin → `forbidden`; note of 501 chars → `validation_failed`; reject → `pending_decision 'rejected'`.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/workflows-lifecycle.test.ts tests/db/workflows-rls.test.ts`; `pnpm test:security tests/security/grants.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 4: M23-T4 Migration 0096 part 3 — `workflow_metric` (Sonnet, DB owner)
READ: BRIEF-COMMON.md; rulings (Metrics table); `…0014_attendance_submit.sql` (notify-code jsonb path); `…0071*.sql` (submissions); `…0074*.sql` (M12 overdue predicate)
FILES: `supabase/migrations/20261028000096_workflows.sql` (append part 3); `tests/db/workflows-metrics.test.ts` (new); `src/lib/db/types.ts` (regen)
MIGRATION: `20261028000096_workflows.sql` (part 3)
EXPORTS: `public.workflow_metric(p_institution_id uuid, p_metric text, p_entity_id uuid, p_as_of timestamptz) returns int` per rulings; execute service_role only.
TEST FIRST (fixture data per metric, fixed `p_as_of`, tz `Asia/Kolkata`): session with 2 absent + 1 present → `session_absences` 2; a student absent on the section's last 3 submitted daily sessions and another absent on 2 → `repeat_absentees` 1; only 2 submitted sessions → 0; a period session (`period_id` set) is ignored; assignment due tomorrow local with 3 active enrolled students, 1 submitted → 2; a withdrawn enrolment is not counted; paper `held_on` d+3 → 1, d+9 → 0, published exam → 0; issued overdue invoice 1, paid 0, due today 0; enquiry `new` 3 days old 1, 1 day old 0, `contacted` 0; B's session id under A → 0; unknown metric and null entity for a subject metric → `validation_failed`; authenticated caller → permission denied.
ACCEPT: `pnpm db:reset`; `pnpm db:types`; `pnpm test:db tests/db/workflows-metrics.test.ts`; `pnpm test:security tests/security/grants.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 5: M23-T5 Catalog + Zod schemas (Haiku)
READ: BRIEF-COMMON.md; rulings (Events, Metrics, Graph rules 1–3, Actions, Queries); `src/lib/modules/catalog.ts` (seed-safe style); `src/modules/timetable/schemas.ts` (style); M15 `src/modules/reports/schemas.ts` (`CronSchema`)
FILES: `src/modules/workflows/catalog.ts` (new); `src/modules/workflows/schemas.ts` (new; relative `.ts` imports); `tests/unit/workflows-schemas.test.ts` (new)
MIGRATION: none
EXPORTS: catalog — `WORKFLOW_ENGINE_VERSION = "workflows_v1"`; `WORKFLOW_EVENTS` (3: `{ label; module: ModuleKey }`) + `WorkflowEventKey`; `WORKFLOW_METRICS` (6: `{ label; module: ModuleKey; event: WorkflowEventKey | null }`) + `WorkflowMetricKey`; `NOTIFY_ROLES` (7); `CONDITION_OPS = ["gt","gte","lt","lte","eq"]`; `NODE_MODULE` (`fee_defaulters` → `finance_plus`, `report` → `scheduled_reports`, `agent` → `agents`). schemas — `WorkflowNodeSchema` (id regex, `type` in the 7 supported + `tool` (rejected later by `parseGraph`), label, `config: z.record(z.string(), z.string().max(500))`, x?, y?), `GraphEdgeSchema` (`label?` in `true|false|approved|rejected`); `WorkflowSaveSchema {id? uuid, name trim 1–80, nodes 2–30, edges 1–60}`; `WorkflowStatusSchema {id, status: draft|active|paused|disabled}`; `WorkflowRunNowSchema {id}`; `WorkflowDecideSchema {runId, decision: approve|reject, note? trim ≤ 500}`; `WorkflowListSchema {status?}`; `WorkflowRunsSchema {workflowId?, status? (4 DB values), limit int 1–100 default 50}`; `WorkflowRunJobPayloadSchema {run_id uuid}`; all `.strict()`, plus inferred types. Every metric/event `module` is a `ModuleKey` (typed).
TEST FIRST: every metric with an `event` names an existing event; every module value is in `MODULE_KEYS`; valid save parses; node id `A1` rejected; 31 nodes rejected; edge label `maybe` rejected; config value of 501 chars rejected; `limit` defaults to 50; unknown key rejected everywhere; job payload without `run_id` rejected.
ACCEPT: `pnpm test tests/unit/workflows-schemas.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 6: M23-T6 Notification template `workflow_alert` (Haiku)
READ: BRIEF-COMMON.md; rulings (Notification template); `src/modules/notifications/templates.ts`; `tests/unit/notification-templates.test.ts`
FILES: `src/modules/notifications/templates.ts` (Edit only); `tests/unit/notification-templates.test.ts` (edit)
MIGRATION: none
EXPORTS: `NOTIFICATION_TYPES` + `"workflow_alert"`; template per rulings (EN/HI text exact).
TEST FIRST: renders EN `Absence follow-up: 2 absent` and the HI title; channels exactly `["in_app"]`; category `announcement`; missing `message` and a 301-char message rejected by `varsSchema`.
ACCEPT: `pnpm test tests/unit/notification-templates.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 7: M23-T7 Graph validator `parseGraph` + `triggerColumns` (Sonnet)
READ: BRIEF-COMMON.md; rulings (Graph rules); T5 catalog/schemas; M15 `CronSchema`; M22 `src/modules/agents/catalog.ts` (`AGENT_SLUGS`)
FILES: `src/modules/workflows/graph.ts` (new, pure, relative `.ts` imports); `tests/unit/workflows-graph.test.ts` (new)
MIGRATION: none
EXPORTS: `type ParsedNode` (discriminated union on `type` with typed config: `TriggerConfig`, `ConditionConfig`, `NotifyConfig`, `ReportConfig`, `AgentConfig`, `ApprovalConfig`); `type ParsedGraph = { nodes: ReadonlyMap<string, ParsedNode>; out: ReadonlyMap<string, readonly { target: string; label?: string }[]>; triggerId: string }`; `parseGraph(input)`; `triggerColumns(graph)`; `nextNode(graph, nodeId, label?: string): string | null`.
TEST FIRST: minimal manual `trigger → end` ok; the 5-node fee graph from the rulings ok; two triggers; trigger with an incoming edge; cycle; unreachable node; no `end`; `tool` node; condition without a `true` edge; condition edge labelled `approved`; notify with two out-edges; unknown metric; subject metric under a schedule trigger; `roles` with `guardian`; message of 201 chars; `fee_defaulters` with no approval before it; `fee_defaulters` reached through a `rejected` edge; two agent nodes for one slug; cron `*/5 * * * *`; unknown config key — each gives an error naming the node; `triggerColumns` for schedule/event/manual.
ACCEPT: `pnpm test tests/unit/workflows-graph.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 8: M23-T8 Engine `runWorkflow` (Opus)
READ: BRIEF-COMMON.md; rulings (Engine, AI boundary evidence note); T7 `graph.ts`; `src/modules/jobs/runner.ts` (`runOnceCore` + ports pattern)
FILES: `src/modules/workflows/engine.ts` (new, pure, relative `.ts` imports); `tests/unit/workflows-engine.test.ts` (new)
MIGRATION: none
EXPORTS: `NodeOutcome`, `EnginePorts`, `EngineStart`, `EngineResult`, `runWorkflow(graph, start, ports)` per rulings.
TEST FIRST (fake ports with call log, fixed `now`): condition true → notify called once with `{count}` replaced by the metric value → `done`, 4 steps, condition note `"finance.overdue_invoices = 3 (gte 1): true"`; condition false without a `false` edge → `done`, notify not called; metric module off → condition `skipped`, `false` path; agent module off → agent `skipped`, port not called, run continues; approval → `awaiting_approval`, cursor = node id, last step `running`; resume `approved` → follows `approved`, approval step `done` "Approved", `lastValue` from start used in the message; resume `rejected` without a `rejected` edge → `done`, nothing after it called; port throws → that step `failed` "Failed: notify_failed", run `failed`, later ports not called; `fee_defaulters` with `finance_plus` off → `skipped`; `runWorkflow` never rejects (a throwing `metric` included); steps carry `ports.now()`.
ACCEPT: `pnpm test tests/unit/workflows-engine.test.ts tests/unit/workflows-graph.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 9: M23-T9 Seeded workflow templates (Haiku)
READ: BRIEF-COMMON.md; rulings (Seeded workflows — transcribe exactly); T7 `parseGraph`
FILES: `src/modules/workflows/templates.ts` (new; relative `.ts` imports, `import type` for `WorkflowNode`/`GraphEdge`); `tests/unit/workflows-templates.test.ts` (new)
MIGRATION: none
EXPORTS: `WORKFLOW_TEMPLATES` (5, rulings order).
TEST FIRST: every template passes `parseGraph`; keys and names unique; `triggerColumns` gives event `attendance.absences_submitted` for the first and the 4 crons for the rest; every notify message ≤ 200 chars; only `fee_reminder` has an approval and a `fee_defaulters` node; only `admissions_follow_up` has an agent node (`admissions`).
ACCEPT: `pnpm test tests/unit/workflows-templates.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 10: M23-T10 Agent queue helper (Sonnet)
READ: BRIEF-COMMON.md (lessons 3, 11); rulings (Agent queue); M22 `src/modules/agents/catalog.ts`, `service-role.ts` (`ensureAgentDefinitions`), 0095 `agent_runs` columns
FILES: `src/modules/agents/queue.ts` (new, plain-node safe); `tests/db/agents-queue.test.ts` (new)
MIGRATION: none
EXPORTS: `queueWorkflowAgentRun(admin: SupabaseClient<Database>, input: { institutionId: string; slug: string; task: string; requestedBy: string; workflowRunId: string })` per rulings.
TEST FIRST (service-role fixtures; a workflow + run inserted first): queues a `queued` run with `workflow_run_id`, `requested_by`, `risk_class read_only`, current `catalog_version`; second call → same `runId`, `created: false`; institution with no definitions → 6 definition rows materialised; disabled definition → `{ status: "disabled" }`, no run; unknown slug → throws `invalid_agent`.
ACCEPT: `pnpm test:db tests/db/agents-queue.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 11: M23-T11 Engine ports (Sonnet)
READ: BRIEF-COMMON.md (lessons 8, 10, 11); rulings (Ports); T8 `EnginePorts`; `src/modules/jobs/handlers/notify.announcement.ts` (memberships + `createNotification`); M12 `finance.fee_reminder` key in 0074; M15 `report.generate` payload; T10 helper
FILES: `src/modules/workflows/ports.ts` (new, plain-node safe); `tests/db/workflows-ports.test.ts` (new)
MIGRATION: none
EXPORTS: `createEnginePorts(admin, run, workflow, settings, now)` per rulings.
TEST FIRST (fixture institution, service role): `metric` returns the SQL count; `notify` roles `principal,admin` → one `workflow_alert` per active principal/admin, none for a `disabled` membership or a teacher, rerun → no new rows; roles with no members → `skipped`; `fee_defaulters` → one `finance.fee_reminder` job `{term_id, as_of}` with M12's key, twice → one job, no current term → `skipped`; `report` on an active schedule → one `report.generate` job, paused → `skipped`, B's schedule id → `skipped`; `agent` → queued agent run, disabled definition → `skipped`; a failing rpc → throws `metric_failed` (no SQL text).
ACCEPT: `pnpm test:db tests/db/workflows-ports.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 12: M23-T12 Job handler `workflow.run`
READ: BRIEF-COMMON.md (lesson 11); rulings (Handler); T3 functions; T7/T8/T11; M15 `report.generate` handler (style); `src/modules/jobs/{types,registry}.ts`, `handlers/index.ts`
FILES: `src/modules/jobs/handlers/workflow.run.ts` (new); `tests/db/workflow-run-job.test.ts` (new); + registries `jobs/types.ts` (`JobType`), `jobs/registry.ts` (`JOB_REGISTRY` + `JOB_MODULES` row), `handlers/index.ts`
MIGRATION: none
EXPORTS: `workflowRun: JobHandler` per rulings.
TEST FIRST (runs created through `emit_workflow_event` / `start_workflow_run`; handler called directly with the claimed job row): condition true → run `done`, steps trigger/condition/notify/end, `engine_version` set, principal has a `workflow_alert`; approval graph → `awaiting_approval`, `cursor_node_id` set, `finished_at` null; `decide_workflow_run` approve then handler on the resume job → `done`, steps appended (not replaced); reject without a `rejected` edge → `done`; `workflows` off → no-op, run stays `running`; run already `done` → no-op; snapshot with a cycle (service-role insert) → `failed` with a `_run` step; metric rpc failure → `failed`; handler run twice on the same job → one notification per recipient.
ACCEPT: `pnpm test:db tests/db/workflow-run-job.test.ts tests/db/jobs.test.ts`; `pnpm test tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 13: M23-T13 Runner sweep port `enqueueDueWorkflows`
READ: BRIEF-COMMON.md; rulings (Sweep port); `src/modules/jobs/runner.ts` (M15 `enqueueDueReports` and any later sweeps); `tests/unit/jobs-runner.test.ts`
FILES: `src/modules/jobs/runner.ts` (Edit only); `tests/unit/jobs-runner.test.ts` (edit)
MIGRATION: none
EXPORTS: `RunnerPorts.enqueueDueWorkflows(): Promise<number>`; real port `admin.rpc("enqueue_due_workflows")`; one call per `runOnceCore` per rulings. `RunOnceSummary` unchanged.
TEST FIRST: called exactly once per `runOnceCore`, before the first `claimJob` and after the existing sweeps; a rejection → jobs still claimed and the other sweeps still run; the real port calls the rpc; `fakePorts` gains `enqueueDueWorkflows: vi.fn(async () => 0)`.
ACCEPT: `pnpm test tests/unit/jobs-runner.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 14: M23-T14 Event emission from existing jobs
READ: BRIEF-COMMON.md (lesson 11); rulings (Events); the three handlers named there; T3 `emit_workflow_event`
FILES: `src/modules/workflows/events.ts` (new, plain-node safe); one emit line each in `src/modules/jobs/handlers/notify.attendance_absence.ts`, `notify.results_published.ts`, `notify.enquiry_received.ts` (mechanical, exception to the ≤ 3-files limit); `tests/db/workflow-events.test.ts` (new)
MIGRATION: none
EXPORTS: `emitWorkflowEvent(admin, institutionId: string, event: WorkflowEventKey, entityId: string): Promise<number>`.
TEST FIRST: active workflow on `attendance.absences_submitted`; submit a session with 2 guardian-notified absences; run both absence jobs → exactly 1 run with `entity_id` = session id, guardians still notified; paused workflow → no run; `workflows` off → no run, notifications unchanged; `results.published` with 3 result jobs → 1 run per exam; `enquiry.received` → 1 run; an absence record with a non-notify status → no emit.
ACCEPT: `pnpm test:db tests/db/workflow-events.test.ts tests/db/jobs.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 15: M23-T15 Actions `workflow.save`, `workflow.setStatus`
READ: BRIEF-COMMON.md (lessons 10, 13); rulings (Actions, ErrorCode map); `src/modules/timetable/actions.ts` (style, 23505 mapping); T5 schemas; T7 `parseGraph`/`triggerColumns`
FILES: `src/modules/workflows/actions.ts` (new, `"use server"`); `tests/db/workflows-actions.test.ts` (new); + manifest line + 2 C-03 fixtures (`workflow.save` minimal manual `trigger → end` graph; `workflow.setStatus { id: U(), status: "paused" }`)
MIGRATION: none
EXPORTS: `saveWorkflow` = `defineAction({ name: "workflow.save", module: "workflows", schema: WorkflowSaveSchema, permission: "workflow.manage" })`; `setWorkflowStatus` = `workflow.setStatus` — per rulings.
TEST FIRST: principal saves a 4-node schedule graph → draft, version 1, trigger columns derived, audit `workflow.saved`; changed graph → version 2; cycle → `validation_failed` with `fieldErrors.graph`; `tool` node → `validation_failed`; activate → `nextRunAt` set, audit `workflow.status`; graph save while active → `invalid_state` "Pause the workflow to edit it."; rename while active → ok, version unchanged; pause → save → version 3 → activate; `draft→paused` → `invalid_state`; duplicate name → `conflict` with `fieldErrors.name`; admin and teacher → `forbidden`; B's principal updating A's id → `not_found`. **Module off → forbidden (the milestone's one module test):** `{ modules: { workflows: false } }` → `workflow.save` `forbidden` with `MODULE_DISABLED_MESSAGE`.
ACCEPT: `pnpm test:db tests/db/workflows-actions.test.ts`; `pnpm test:security tests/security/escalation.test.ts tests/security/module-gate.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 16: M23-T16 Actions `workflow.runNow`, `workflow.run.decide`
READ: BRIEF-COMMON.md; rulings (Actions, Run lifecycle errors); T3 RPCs; T15 `actions.ts`
FILES: `src/modules/workflows/actions.ts` (edit); `tests/db/workflows-run-actions.test.ts` (new); + 2 C-03 fixtures (`{ id: U() }`, `{ runId: U(), decision: "reject" }`)
MIGRATION: none
EXPORTS: `runWorkflowNow` = `workflow.runNow`; `decideWorkflowRun` = `workflow.run.decide` — both `workflow.manage`, `module: "workflows"`, RPC errors via `mapSqlError`.
TEST FIRST: principal runs an active schedule workflow now → `runId`, one `workflow.run` job; second call in the same minute → same `runId`; event workflow → `invalid_state`; paused → `invalid_state`; admin → `forbidden`; awaiting run (service-role insert) → principal approve → `{ status: "running" }`; again → `invalid_state`; admin decide → `forbidden`; B's run → `not_found`; reject with note → stored note, audit row without the note text.
ACCEPT: `pnpm test:db tests/db/workflows-run-actions.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 17: M23-T17 Queries `workflows.list`, `workflows.runs`
READ: BRIEF-COMMON.md; rulings (Queries); `Workflow`/`WorkflowRun` in `src/modules/fabric/types.ts`; `src/modules/timetable/query-defs.ts` (pattern); `core.audit.list` actor-name lookup
FILES: `src/modules/workflows/queries.ts` (new); `src/modules/workflows/query-defs.ts` (new); `tests/db/workflows-queries.test.ts` (new); + `all-queries.ts` line + 2 smoke samples (`{}` each)
MIGRATION: none
EXPORTS: `workflows.list`, `workflows.runs` per rulings (`workflow.read`, `module: "workflows"`).
TEST FIRST: list returns objects whose keys equal the `Workflow` fixture keys exactly, `trigger` `{ type, config }`, `created_by` = principal's full name; filter by status; runs newest first, filter by `workflowId` and `status`, `limit`; keys equal the `WorkflowRun` fixture keys; admin can read; teacher → `forbidden`; B's owner → `[]`.
ACCEPT: `pnpm test:db tests/db/workflows-queries.test.ts tests/db/api-query-route.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: `Workflow` (`workflows()`), `WorkflowRun` (`workflowRuns()`)

### Task 18: M23-T18 Approvals union: `workflow_run` + queued agent runs
READ: BRIEF-COMMON.md; rulings (Approvals union); `src/modules/core/approvals.queries.ts` (M16 + M19/M22 branches); `tests/db/approvals-agent-runs.test.ts` (fixture pattern); M22 `canDecideRun`
FILES: `src/modules/core/approvals.queries.ts` (Edit: one new block + one condition in the `agent_run` block); `tests/db/approvals-workflow-runs.test.ts` (new)
MIGRATION: none
EXPORTS: `pendingApprovals` gains the `workflow_run` block and lists queued agent runs. `ApprovalRow` unchanged.
TEST FIRST (service-role fixtures): principal sees an awaiting run as `{ kind: "workflow_run", title: "Fee reminder: Send fee reminders…", requestedBy: "Automation" }`, oldest first; admin sees none (no `workflow.manage`); `workflows` off → none; `done` runs never; a queued agent run requested by the principal → `agent_run` row `"Admissions agent: workflow task waiting to start"`; an admin who is not the requester → not listed; the existing `approvals-agent-runs` and `approvals-pending` tests stay green.
ACCEPT: `pnpm test:db tests/db/approvals-workflow-runs.test.ts tests/db/approvals-agent-runs.test.ts tests/db/approvals-pending.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 19: M23-T19 Action `agent.start`
READ: BRIEF-COMMON.md (lessons 6, 11); rulings (`agent.start`); M22 `src/modules/agents/actions.ts` (`runAgent`), `service-role.ts`, `tests/db/agents-run-action.test.ts` (executor mock)
FILES: `src/modules/agents/actions.ts` (Edit: extract `finishRun`, add the action); `tests/db/agents-start-action.test.ts` (new); + 1 C-03 fixture (`{ runId: U() }`)
MIGRATION: none
EXPORTS: `startAgentRun = defineAction({ name: "agent.start", module: "agents", schema: DecideAgentRunSchema.pick({ runId: true }), permission: "agent.run" })` per rulings → `{ runId, status, summary }`.
TEST FIRST (`vi.mock("@/modules/agents/executor")` canned outcomes; queued runs inserted with the service-role client): requester (principal) starts → executor called once, row leaves `queued`, audit `agent.start` without task text; second start → `invalid_state`; two concurrent starts → one ok, one `conflict`; admin non-requester → `forbidden`; owner (holds `agent.approve`) → ok; disabled definition → `invalid_state`; `agents` off → `forbidden`; teacher → `forbidden`; existing `agents-run-action` tests unchanged.
ACCEPT: `pnpm test:db tests/db/agents-start-action.test.ts tests/db/agents-run-action.test.ts`; `pnpm test:security tests/security/escalation.test.ts`; `pnpm test tests/unit/action-names-unique.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 20: M23-T20 Seed section `workflows` (Sonnet, seed owner)
READ: BRIEF-COMMON.md (seed rules); `scripts/seed/index.ts`, `scripts/seed/sections/timetable.ts` (uuidV5, demo principal lookup); T9 templates; T7 `triggerColumns`; `tests/db/seed-determinism.test.ts`
FILES: `scripts/seed/sections/workflows.ts` (new; relative `.ts` imports); `scripts/seed/index.ts` (Edit: register after the finance and admissions sections); `tests/db/seed-workflows.test.ts` (new)
MIGRATION: none
EXPORTS: the 5 templates as `active` workflows of the demo tenant, ids `uuidV5("workflow:<key>")`, `version 1`, trigger columns from `triggerColumns`, `created_by` = demo principal. Inserted as postgres (trusted by the guard, so `active` and `next_run_at` are set). No runs, no jobs.
TEST FIRST: demo tenant has 5 active workflows with the template names; each stored graph passes `parseGraph`; the 4 schedule workflows have `next_run_at` in the future; reseed gives identical ids; the section creates no `workflow_runs` and no `jobs` rows.
ACCEPT: `DEMO_RESET_ALLOWED=true pnpm demo:reset`; `pnpm test:db tests/db/seed-workflows.test.ts tests/db/seed-determinism.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 21: M23-T21 Acceptance over HTTP
READ: BRIEF-COMMON.md; `tests/db/timetable-acceptance.test.ts` (route + bearer pattern); M15 acceptance (runner with real ports, `sql` to move `next_run_at`)
FILES: `tests/db/workflows-acceptance.test.ts` (new)
TEST:
1. Principal `POST /api/v1/actions/workflow.save`: event workflow on `attendance.absences_submitted`, graph `trigger → condition attendance.session_absences gte 1 → notify principal "{count} absent today" → approval → agent attendance → end` (`rejected` → end). Then `workflow.setStatus active` → 200.
2. Teacher marks and submits a session with 1 absent through `attendance.*` actions. `runOnceCore` with real ports (twice if needed) → `GET /api/v1/query/workflows.runs` shows the run `awaiting_approval`; principal has a `workflow_alert` "…: 1 absent today"; `core.approvals.pending` lists a `workflow_run` row.
3. Admin `workflow.run.decide` → 403. Principal approve → 200. Runner → run `done`; an `agent_runs` row is `queued` with `workflow_run_id`; approvals now list the `agent_run` "waiting to start" row.
4. Principal `workflow.setStatus disabled`; another session submitted with an absence; runner → no new run (disabling stops the trigger).
5. Schedule workflow (`0 20 * * *`, condition `finance.overdue_invoices gte 0`, notify accountant): activated; `next_run_at` moved 1 minute into the past (`sql`); runner → one `done` run, `next_run_at` = tomorrow 20:00 IST; runner again → still one run.
6. Teacher `GET /api/v1/query/workflows.list` → 403; admin → 200.
ACCEPT: `pnpm test:db tests/db/workflows-acceptance.test.ts`; `pnpm lint`; `pnpm typecheck`
REPLACES FIXTURE: none

### Task 22: M23-T22 Docs (Haiku)
FILES (Edit only):
- `docs/planning/coolskool/10-backlog-index.md` §3: `0096` → "(M23, built)".
- `docs/planning/coolskool/07-security-and-ai-governance.md` §4: definers `app.create_workflow_run` (internal), `public.emit_workflow_event` and `public.enqueue_due_workflows` (service_role only, called by job handlers / the runner, check `app.module_enabled`), `public.start_workflow_run` and `public.decide_workflow_run` (authenticated, owner/principal, module-checked); service-role invoker `public.workflow_metric` (institution filter is the only filter); guards `app.guard_workflow_write` (definer, trusted = service_role/postgres) and `app.guard_workflow_run_update` (invoker, no bypass); job writes from `workflow.run` (`jobs` rows `report.generate` and `finance.fee_reminder` built from verified rows; `agent_runs` `queued` via `src/modules/agents/queue.ts`).
- `05-data-architecture.md`: §2 rows for `workflows`, `workflow_runs`; §3 ownership `workflows | workflows, workflow_runs`.
- `06-workflows-and-contracts.md` §7: job `workflow.run` (payload `{run_id}`; keys `workflow.run:<run>:start` / `:<node>`); the 3 events and their emitters; the run state machine; the 6 metrics.
- `12-decision-log.md`: next free D-number "M23 deviations" (the 4 deviations in the rulings). Next free DBT rows: approvals never expire; reaper fails `running` runs after 6 h, and runs are not resumed after a module comes back on; one manual run per workflow per minute; notify audiences are school-wide roles (no class-teacher audience); `workflow_alert` is in-app only and the authored message is not translated; graph edits in place; an agent node does not wait for its agent run; `catalog_version` is fixed at queue time; a re-run attempt can re-evaluate conditions; `queueWorkflowAgentRun` duplicates `ensureAgentDefinitions`.
- `docs/planning/fabric/02-architecture.md` §4: row 0056 → `0096`, Read owner/principal/admin, Write owner/principal, "version bumps in place; runs snapshot the graph".
- `docs/planning/fabric/03-roadmap-and-tracker.md` workflow rows: statuses unchanged (UI reads fixtures until Workstream D); notes = real enforcement + test files; honesty label `<LimitedBadge>` per rulings.
ACCEPT: `pnpm lint` (docs only; no code)

---

Controller after T22: security review (Sonnet) on T3, T11, T12, T15, T16, T19 diffs; full gate; `pnpm db:reset` + `pnpm seed` clean; commit/push; hosted push of 0096 owner-run, then a demo reseed (5 active workflows appear; nothing reaches families before a principal approves); `DONE M23 <sha>`.
