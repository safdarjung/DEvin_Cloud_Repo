# Fabric Data Contracts — F-BE-22

Fixture calls (§1), demo data generators (§2), row types (§3), demo store (§4), canvas rendering (§5).

## §1 Fixture Calls

All fixtures accept deterministic `FixtureOpts`:

```typescript
interface FixtureOpts {
  seed?: number;          // mulberry32 seed (default 7)
  now: Date;             // current timestamp (fixtures use addDays)
  institutionId: string; // institution UUID (written to every row.institution_id)
}
```

Every fixture call returns the same rows when given the same opts; `seed` omitted defaults to 7 (unseeded RNG state). Use `.seed(12)` to branch deterministic variations off a base state.

## §2 Demo Data Generators

One table per demo file. **Consumed by** maps each generator to the receiving packet (F-UI-02 through F-BE-15).

| File | Function | Signature | Returns | Notes | Consumed by |
|------|----------|-----------|---------|-------|------------|
| command.ts | dailyBrief | `(opts: FixtureOpts) => DailyBrief` | Single brief row (3–5 items) | Role scoped; fixture chooses one role | F-UI-02 command |
| command.ts | priorityActions | `(opts: FixtureOpts) => PriorityAction[]` | [1..8] actions, each with due/severity | Links to insights or routes; owner field | F-UI-02 command |
| command.ts | forecastCards | `(opts: FixtureOpts) => ForecastCard[]` | [1..5] metrics; each metric/unit/confidence | numeric trend (up/flat/down direction) | F-UI-02 command |
| command.ts | riskIndicators | `(opts: FixtureOpts) => RiskIndicator[]` | [1..6] risks; each label/level/trend | Maps to insights via insight_id or null | F-UI-02 command |
| command.ts | defaultWidgetOrder | `(opts: FixtureOpts) => Record<role, string[]>` | Dashboard widget layout per role | Widget IDs in display order | F-UI-02 command |
| agents.ts | agentDefinitions | `(opts: FixtureOpts) => AgentDefinition[]` | [1..12] agents | Names, tools, permissions, risk tier, cost/30d | F-BE-10 agents |
| agents.ts | agentRuns | `(opts: FixtureOpts) => AgentRun[]` | [1..20] runs; mixed status | Links to agent_id; cost tracking; logs array | F-BE-10 agents |
| agents.ts | workflows | `(opts: FixtureOpts) => Workflow[]` | [1..5] active workflows | DAG: nodes/edges; trigger config | F-BE-09 workflows |
| agents.ts | workflowRuns | `(opts: FixtureOpts) => WorkflowRun[]` | [1..15] runs; mixed status | Steps array with per-node status/timing | F-BE-09 workflows |
| insights.ts | insights | `(opts: FixtureOpts) => Insight[]` | [1..20] insights; mixed domain/severity | Pattern + evidence + confidence; factors; sources | F-UI-07 insights, F-BE-07 insights |
| insights.ts | insightActions | `(opts: FixtureOpts) => InsightAction[]` | [1..12] actions; some measured | Links insight_id → action owner/outcome | F-UI-07 insights |
| operations.ts | timetableConflicts | `(opts: FixtureOpts) => TimetableConflict[]` | [1..8] conflicts; mixed kind | Day/period/entities/suggestion | F-UI-05 operations |
| operations.ts | teacherWorkloads | `(opts: FixtureOpts) => TeacherWorkload[]` | [1..24] staff; mixed utilisation | Periods/max/subjects/sections/leave dates | F-UI-05 operations |
| operations.ts | transportRoutes | `(opts: FixtureOpts) => TransportRoute[]` | [1..5] routes; mixed on-time/delayed | Stops array; capacity/assigned; driver name | F-UI-05 operations |
| operations.ts | maintenanceRequests | `(opts: FixtureOpts) => MaintenanceRequest[]` | [1..10] requests; mixed status | Asset/location/issue/priority/assignee | F-UI-05 operations |
| operations.ts | roomUtilisation | `(opts: FixtureOpts) => RoomUtilisation[]` | [1..8] rooms | Periods_used/total; capacity utilisation % | F-UI-05 operations |
| finance-intel.ts | financeForecast | `(opts: FixtureOpts) => FinanceForecastPoint[]` | [1..12] monthly points | Month; collected/expected/forecast_low/high paise | F-UI-06 finance |
| finance-intel.ts | outstandingAlerts | `(opts: FixtureOpts) => OutstandingAlert[]` | [1..20] students overdue | Paise amount; days_overdue; concession flag | F-UI-06 finance |
| finance-intel.ts | budgetLines | `(opts: FixtureOpts) => BudgetLine[]` | [1..12] budget categories | Budget/actual paise; variance % | F-UI-06 finance |
| personal.ts | personalMemories | `(opts: FixtureOpts, userId: string) => PersonalMemory[]` | [1..10] memories | Kind (preference/goal/fact/project/context); is_shared flag | F-UI-13 personal |
| personal.ts | personalGoals | `(opts: FixtureOpts, userId: string) => PersonalGoal[]` | [1..5] goals | Progress%; tasks array (id/title/done); due_date | F-UI-13 personal |
| personal.ts | workspaces | `(opts: FixtureOpts) => WorkspaceSummary[]` | [1..4] summaries | Kind (personal/institution/business/household); is_current | F-UI-13 personal |
| personal.ts | boundaryPreview | `(opts: FixtureOpts, userId: string) => BoundaryPreviewResult` | Privacy boundary state | Renders which data is shared with institution | F-UI-13 personal |
| success.ts | studentSuccessRows | `(opts: FixtureOpts) => StudentSuccessRow[]` | [1..30] students | Mastery%/attendance%/trend/risk level/support owner | F-UI-04 success |
| success.ts | interventionPlans | `(opts: FixtureOpts) => InterventionPlan[]` | [1..8] plans; mixed status | Student_id/owner/goal/steps with due dates | F-UI-04 success |
| trust.ts | auditEvents | `(opts: FixtureOpts) => AuditEventRow[]` | [1..40] events; sorted by at DESC | Actor/role/event/entity/entity_id/summary | F-UI-15 audit |
| trust.ts | modelRegistry | `(opts: FixtureOpts) => ModelRegistryEntry[]` | [1..12] models; local + cloud | Provider/model/version/cost per 1k in/out; eval_score | F-BE-07 insights |
| trust.ts | consentRecords | `(opts: FixtureOpts) => ConsentRecord[]` | [1..10] records; granted/denied | User_label/subject/purpose/expires_at | F-UI-15 consent |
| trust.ts | permissionReviews | `(opts: FixtureOpts) => PermissionReview[]` | [1..12] reviews; mixed due/reviewed | Member/role/extra_permissions; due date | F-UI-15 trust |
| marketplace.ts | marketplaceModules | `(opts: FixtureOpts) => MarketplaceModule[]` | [1..50] modules; global (no institution_id) | Slug/category/pricing/required_permissions; changelog | F-UI-11 marketplace |
| marketplace.ts | initialInstalls | `(opts: FixtureOpts) => ModuleInstall[]` | [1..8] installs; initial subset | Module_id/status (pending_approval/installed); version | F-UI-11 marketplace |
| studio.ts | studioRequests | `(opts: FixtureOpts) => StudioRequest[]` | [1..5] requests; mixed status | Title/problem/desired_outcome/budget_range/timeline | F-UI-12 studio |
| studio.ts | studioProposals | `(opts: FixtureOpts) => StudioProposal[]` | [1..8] proposals; mixed version | Request_id/resolution/interpretation/clarifying_questions | F-UI-12 studio |
| simulator.ts | scenarios | `(opts: FixtureOpts) => Scenario[]` | [1..5] scenarios; mixed status | Name/assumptions/results (null when draft); rationale | F-UI-03 simulator |
| twin.ts | twinSnapshot | `(opts: FixtureOpts, state: "historical" \| "current" \| "scenario") => TwinSnapshot` | One snapshot | Nodes/edges DAG; as_of date; scenario_id | F-UI-09 twin |
| twin.ts | changeImpact | `(snapshot: TwinSnapshot, nodeId: Id) => ChangeImpact` | Impact of change on node | Affected array: node_id/effect/severity | F-UI-09 twin |
| learning.ts | masteryCells | `(opts: FixtureOpts) => MasteryCell[]` | [1..24] cells | Section/subject/topic; mastery%; students_below_threshold | F-UI-03 learning |
| learning.ts | curriculumCoverage | `(opts: FixtureOpts) => CurriculumCoverage[]` | [1..6] subjects | Subject/section; planned_units/completed_units; on_track | F-UI-03 learning |
| learning.ts | assessmentPlan | `(opts: FixtureOpts) => AssessmentPlanItem[]` | [1..20] assessments | Title/subject/section/kind/date; status; real source `exams.schedule` M11 | F-UI-03 learning |
| data.ts | connectors | `(opts: FixtureOpts) => Connector[]` | [1..8] connectors; mixed status | Slug/kind/provider/scopes; last_sync_at; records_synced | F-UI-14 data |
| data.ts | connectorSyncs | `(opts: FixtureOpts) => ConnectorSync[]` | [1..20] syncs; mixed status | Connector_id/status/records/errors array | F-UI-14 data |
| data.ts | dataQualityScores | `(opts: FixtureOpts) => DataQualityScore[]` | [1..12] entities | Entity name; score 0–100; issues array (kind/count) | F-UI-14 data |
| data.ts | lineage | `(opts: FixtureOpts) => { nodes: LineageNode[], edges: GraphEdge[] }` | DAG of data nodes | Source/table/metric/report/widget nodes + edges | F-UI-14 data |

## §3 Row Types

Listed by migration header. Compact field listing per interface.

### 0052 Marketplace
**MarketplaceModule**: `id: Id`, `slug: string`, `name: string`, `category: ModuleCategory`, `summary: string`, `description: string`, `vendor: string`, `version: string`, `pricing: {model: PricingModel, amount_paise: number|null, unit?: string}`, `required_permissions: string[]`, `required_integrations: string[]`, `dependencies: string[]`, `supported_products: string[]`, `intended_roles: string[]`, `rating: number|null`, `installs_count: number`, `is_featured: boolean`, `released_at: ISODate`, `changelog: {version: string, date: ISODate, note: string}[]`, `created_at: ISODate`, `updated_at: ISODate`.

**ModuleInstall**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `module_id: Id`, `status: ModuleInstallStatus`, `version: string`, `installed_by: string`, `config: Record<string, string|number|boolean>`.

### 0053 Scenarios
**Scenario**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `name: string`, `status: ScenarioStatus`, `is_baseline: boolean`, `assumptions: ScenarioAssumptions`, `results: ScenarioResults|null`, `rationale: string`, `created_by: string`.

### 0054 Insights
**Insight**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `title: string`, `domain: InsightDomain`, `severity: InsightSeverity`, `kind: InsightKind`, `pattern: string`, `evidence: {label: string, value: number, unit?: string}[]`, `sources: string[]`, `date_from: ISODate`, `date_to: ISODate`, `confidence: number`, `factors: {label: string, weight: number}[]`, `reviewer_role: string`, `recommended_actions: string[]`, `approval_required: boolean`, `status: InsightStatus`, `entity_ref: {type: string, id: Id, label: string}|null`, `signal?: string`, `detector_version?: number`, `explanation?: {what: string, why: string, next_steps: string[], provider: "local"|"cloud", model: string, explained_at: ISODate}|null` (M19).

**InsightAction**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `insight_id: Id`, `action: string`, `owner: string`, `rationale: string`, `expected_outcome: string`, `actual_outcome: string|null`, `decided_at: ISODate`, `measured_at: ISODate|null`, `status: "planned"|"done"|"measured"`.

### 0055 Agents
**AgentDefinition**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `slug: string`, `name: string`, `role_description: string`, `tools: string[]`, `permissions: string[]`, `model_tier: AgentModelTier`, `max_risk_class: RiskClass`, `is_enabled: boolean`, `quality_score: number|null`, `cost_paise_30d: number`, `runs_30d: number`, `error_rate_pct: number`.

**AgentRun**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `agent_id: Id`, `workflow_run_id: Id|null`, `task: string`, `risk_class: RiskClass`, `status: AgentRunStatus`, `started_at: ISODate`, `finished_at: ISODate|null`, `approver: string|null`, `cost_paise: number`, `summary: string`, `log: {at: ISODate, level: "info"|"warn"|"error", text: string}[]`.

### 0056 Workflows
**Workflow**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `name: string`, `version: number`, `status: "draft"|"active"|"paused"|"disabled"`, `trigger: {type: "schedule"|"event"|"manual", config: string}`, `nodes: WorkflowNode[]`, `edges: GraphEdge[]`, `created_by: string`.

**WorkflowRun**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `workflow_id: Id`, `status: "running"|"awaiting_approval"|"done"|"failed"|"paused"`, `started_at: ISODate`, `finished_at: ISODate|null`, `steps: {node_id: Id, status: "pending"|"running"|"done"|"failed"|"skipped", at: ISODate, note?: string}[]`.

### 0057 Studio
**StudioRequest**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `title: string`, `problem: string`, `desired_outcome: string`, `user_roles: string[]`, `existing_systems: string[]`, `integrations: string[]`, `constraints: string`, `budget_range: BudgetRange`, `timeline: string`, `success_criteria: string`, `status: StudioStatus`, `requested_by: string`.

**StudioProposal**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `request_id: Id`, `version: number`, `resolution: StudioResolution`, `interpretation: string`, `clarifying_questions: string[]`, `features: string[]`, `workflows: string[]`, `ux_outline: string[]`, `technical_requirements: string[]`, `integration_requirements: string[]`, `permission_requirements: string[]`, `cost_estimate_paise: number`, `timeline_weeks: number`, `risks: string[]`, `acceptance_criteria: string[]`, `pipeline: {stage: PipelineStage, status: "pending"|"running"|"done"|"failed", agent?: string, note?: string}[]`, `preview_html: string|null`.

### 0058 Personal
**PersonalMemory**: `id: Id`, `user_id: Id`, `kind: "preference"|"goal"|"fact"|"project"|"context"`, `content: string`, `source: "user"|"inferred"`, `is_shared_with_institution: boolean`, `retain_until: ISODate|null`, `created_at: ISODate`, `updated_at: ISODate`.

**PersonalGoal**: `id: Id`, `user_id: Id`, `title: string`, `progress_pct: number`, `due_date: ISODate|null`, `tasks: {id: Id, title: string, done: boolean}[]`, `created_at: ISODate`, `updated_at: ISODate`.

### 0059 Connectors
**Connector**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `slug: string`, `name: string`, `kind: "api"|"webhook"|"file"|"read_only"|"read_write"`, `provider: string`, `scopes: string[]`, `status: ConnectorStatus`, `last_sync_at: ISODate|null`, `records_synced: number`, `owner: string`.

**ConnectorSync**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `connector_id: Id`, `started_at: ISODate`, `finished_at: ISODate|null`, `status: "ok"|"partial"|"failed"`, `records: number`, `errors: string[]`.

### 0060 Twin
**TwinSnapshot**: `id: Id`, `institution_id: Id`, `created_at: ISODate`, `updated_at: ISODate`, `as_of: ISODate`, `state: "historical"|"current"|"scenario"`, `scenario_id: Id|null`, `nodes: TwinNode[]`, `edges: TwinEdge[]`.

### 0061 Dashboard Layouts
**DashboardLayout**: `id: Id`, `user_id: Id`, `institution_id: Id`, `role: string`, `widget_order: string[]`, `hidden: string[]`, `updated_at: ISODate`.

### Derived: Command Centre
**DailyBrief**: `role: string`, `date: ISODate`, `headline: string`, `items: {text: string, insight_id?: Id, href?: string}[]`, `generated_by: "fixture"|"local_model"`.

**PriorityAction**: `id: Id`, `title: string`, `why: string`, `href: string`, `owner: string`, `due: ISODate`, `severity: InsightSeverity`.

**ForecastCard**: `metric: string`, `current: number`, `forecast: number`, `unit: "count"|"pct"|"paise"`, `confidence: number`, `direction: "up"|"flat"|"down"`.

**RiskIndicator**: `id: Id`, `label: string`, `level: InsightSeverity`, `trend: "up"|"flat"|"down"`, `insight_id: Id|null`.

### Derived: Learning
**MasteryCell**: `section_id: Id`, `section_label: string`, `subject: string`, `topic_id: Id`, `topic: string`, `mastery_pct: number`, `students_below_threshold: number`.

**CurriculumCoverage**: `subject: string`, `section_label: string`, `planned_units: number`, `completed_units: number`, `on_track: boolean`.

**AssessmentPlanItem**: `id: Id`, `title: string`, `subject: string`, `section_label: string`, `date: ISODate`, `kind: "unit_test"|"term_exam"|"practical"|"quiz"`, `status: "planned"|"scheduled"|"marked"|"published"`.

### Derived: Student Success
**StudentSuccessRow**: `student_id: Id`, `name: string`, `section_label: string`, `attendance_pct: number`, `mastery_pct: number`, `trend: "up"|"flat"|"down"`, `risk: "none"|"watch"|"support"`, `support_owner: string|null`, `last_contact: ISODate|null`, `flags: string[]`, `gaps: {subject: string, topic: string, mastery_pct: number}[]`.

**InterventionPlan**: `id: Id`, `student_id: Id`, `owner: string`, `goal: string`, `steps: {title: string, due: ISODate, done: boolean}[]`, `status: "proposed"|"active"|"review"|"closed"`, `review_date: ISODate`, `restricted: true`.

### Derived: Operations
**TimetableConflict**: `id: Id`, `day: string`, `period: number`, `kind: "teacher_double_booked"|"room_double_booked"|"teacher_unavailable"|"room_capacity"`, `entities: string[]`, `suggestion: string`.

**TeacherWorkload**: `staff_id: Id`, `name: string`, `periods_week: number`, `max_periods: number`, `subjects: string[]`, `sections: string[]`, `leave_dates: ISODate[]`.

**TransportRoute**: `id: Id`, `name: string`, `vehicle: string`, `driver: string`, `stops: {name: string, eta: string, students: number, x: number, y: number}[]`, `status: "on_time"|"delayed"|"off_road"`, `capacity: number`, `assigned: number`.

**MaintenanceRequest**: `id: Id`, `asset: string`, `location: string`, `issue: string`, `priority: "low"|"medium"|"high"`, `status: "open"|"in_progress"|"done"`, `raised_at: ISODate`, `assignee: string|null`.

**RoomUtilisation**: `room: string`, `capacity: number`, `periods_used: number`, `periods_total: number`.

### Derived: Finance Intelligence
**FinanceForecastPoint**: `month: string`, `collected_paise: number`, `expected_paise: number`, `forecast_low_paise: number`, `forecast_high_paise: number`.

**OutstandingAlert**: `student_id: Id`, `name: string`, `section_label: string`, `outstanding_paise: number`, `days_overdue: number`, `last_reminder: ISODate|null`, `concession: boolean`.

**BudgetLine**: `category: string`, `budget_paise: number`, `actual_paise: number`, `variance_pct: number`.

### Derived: Trust & Governance
**AuditEventRow**: `id: Id`, `institution_id: Id`, `actor: string`, `actor_role: string`, `event: string`, `entity: string`, `entity_id: Id`, `at: ISODate`, `summary: string`.

**ModelRegistryEntry**: `id: Id`, `provider: string`, `model: string`, `tier: "local"|"cloud"`, `version: string`, `cost_per_1k_in_paise: number`, `cost_per_1k_out_paise: number`, `latency_ms_p50: number`, `eval_score: number|null`, `status: "active"|"fallback"|"retired"`.

**ConsentRecord**: `id: Id`, `user_label: string`, `subject: string`, `purpose: string`, `granted: boolean`, `at: ISODate`, `expires_at: ISODate|null`.

**PermissionReview**: `id: Id`, `member: string`, `role: string`, `extra_permissions: string[]`, `last_reviewed: ISODate|null`, `due: ISODate`, `status: "due"|"reviewed"|"revoked"`.

## §4 Demo Store

**Exports** from `src/modules/fabric/store/`:

- `getState(): DemoState` — read current store
- `dispatch(intent: DemoIntent): void` — apply intent, save to localStorage, emit
- `initDemoStore(seedData: Partial<DemoState>): void` — hydrate once (called before first useDemoStore render)
- `useDemoStore<T>(selector: (state: DemoState) => T): T` — React hook; SSR-safe via useSyncExternalStore

**DemoState fields**:
- `version: 1` — schema version (constant)
- `hydrated: boolean` — true after localStorage load
- `layouts: Record<string, string[]>` — dashboard widget order per key
- `installs: ModuleInstall[]` — installed modules
- `scenarios: Scenario[]` — financial/curriculum scenarios
- `requests: StudioRequest[]` — feature requests (studio)
- `proposals: StudioProposal[]` — proposed solutions
- `workflows: Workflow[]` — automation workflows
- `memories: PersonalMemory[]` — personal knowledge base
- `goals: PersonalGoal[]` — personal goals + task tracking
- `interventions: InterventionPlan[]` — student intervention plans
- `insightStatus: Record<string, InsightStatus>` — user-set status per insight
- `insightActions: InsightAction[]` — actions taken on insights
- `notes: Record<string, string>` — free-form notes by key

**DemoIntent types** (all immutable, reducer returns same reference on no-op):

- `{type: "setLayout", key: string, order: string[]}` — set dashboard widget order
- `{type: "installModule", install: ModuleInstall}` — upsert install
- `{type: "uninstallModule", id: Id}` — remove install by id
- `{type: "setInstallStatus", id: Id, status: ModuleInstallStatus}` — update status
- `{type: "saveScenario", scenario: Scenario}` — upsert scenario
- `{type: "deleteScenario", id: Id}` — remove scenario
- `{type: "submitRequest", request: StudioRequest}` — upsert request
- `{type: "setRequestStatus", id: Id, status: StudioStatus}` — update status
- `{type: "saveProposal", proposal: StudioProposal}` — upsert proposal
- `{type: "advancePipeline", request_id: Id}` — mark running stage done, start next pending
- `{type: "saveWorkflow", workflow: Workflow}` — upsert workflow
- `{type: "setWorkflowStatus", id: Id, status: Workflow["status"]}` — update status
- `{type: "upsertMemory", memory: PersonalMemory}` — upsert memory
- `{type: "deleteMemory", id: Id}` — remove memory
- `{type: "upsertGoal", goal: PersonalGoal}` — upsert goal
- `{type: "toggleTask", goal_id: Id, task_id: Id}` — flip task.done boolean
- `{type: "saveIntervention", intervention: InterventionPlan}` — upsert intervention
- `{type: "setInsightStatus", insight_id: Id, status: InsightStatus}` — map set
- `{type: "recordInsightAction", action: InsightAction}` — upsert action
- `{type: "measureOutcome", action_id: Id, actual_outcome: string}` — set outcome + mark measured
- `{type: "setNote", key: string, text: string}` — map set
- `{type: "importState", state: DemoState}` — replace entire state
- `{type: "reset", seedData?: Partial<DemoState>}` — reset to initial (with optional seed data)

## §5 Canvas Spec, Renderer, Flow

**CanvasSpec props** (in `canvas-renderer.tsx`):

- `spec: CanvasSpec` — parsed spec (version/root/nodes)
- `onAction: (action: CanvasAction) => void` — caller handles actions as data

**CanvasSpec schema** (from `src/modules/fabric/spec/schemas.ts`):

- `version: 1` — literal
- `root: string` — node id of root (must be layout or single block, no flow as root)
- `nodes: CanvasNode[]` — ≤24 nodes; flat list, no nesting; id deduplication enforced
- Every node.id is unique; layout children resolve; no cycles in layout DAG

**FlowCanvas props** (in `flow-canvas.tsx`):

- `nodes: Node[]` — @xyflow/react Node array
- `edges: Edge[]` — @xyflow/react Edge array
- `onNodeClick?: NodeMouseHandler` — optional click handler
- `nodeTypes?: NodeTypes` — custom node renderers
- `height?: number` — container height in px (default 480)
- `readOnly?: boolean` — disable dragging (default true)
- `colorMode?: ColorMode` — theme (default "system")

**flowFromSpec** (`flow-from-spec.ts`):

- Input: `{nodes: FlowSpecNode[], edges: FlowSpecEdge[]}`
- Output: `{nodes: Node[], edges: Edge[]}`
- Assigns x/y via BFS depth (longest-path layering); explicit x/y preserved; COLUMN_GAP_PX=220, ROW_GAP_PX=90
