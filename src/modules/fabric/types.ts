// Fabric workspace row types — the UI/data contract for Phase 1 (fixtures) and
// Phase 2 (real tables). Each "table" section mirrors a reserved migration
// (20261028000052–0061, see docs/planning/fabric/02-architecture.md §4)
// column-for-column, snake_case, so queries replace fixtures without touching
// components. Money is integer paise. Dates are ISO strings. "Derived" sections
// are read models computed from existing CoolSkool tables in Phase 2.

export type Id = string;
export type ISODate = string;

export interface BaseRow {
  id: Id;
  institution_id: Id;
  created_at: ISODate;
  updated_at: ISODate;
}

// ---------------------------------------------------------------- 0052 marketplace
export type ModuleCategory =
  | "industry" | "productivity" | "agent" | "workflow" | "analytics"
  | "integration" | "template" | "report" | "simulation" | "custom";
export type PricingModel = "free" | "monthly" | "annual" | "usage" | "custom";

/** Global catalog row (no institution_id; platform-admin owned). */
export interface MarketplaceModule {
  id: Id;
  slug: string;
  name: string;
  category: ModuleCategory;
  summary: string;
  description: string;
  vendor: string;
  version: string;
  pricing: { model: PricingModel; amount_paise: number | null; unit?: string };
  required_permissions: string[];
  required_integrations: string[];
  dependencies: string[]; // module slugs
  supported_products: ("coolskool" | "personal" | "business")[];
  intended_roles: string[];
  rating: number | null; // 0–5
  installs_count: number;
  is_featured: boolean;
  released_at: ISODate;
  changelog: { version: string; date: ISODate; note: string }[];
  created_at: ISODate;
  updated_at: ISODate;
}

export type ModuleInstallStatus = "pending_approval" | "installed" | "disabled" | "uninstalled";
export interface ModuleInstall extends BaseRow {
  module_id: Id;
  status: ModuleInstallStatus;
  version: string;
  installed_by: string;
  config: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------- 0053 scenarios
export type ScenarioStatus = "draft" | "proposed" | "approved" | "rejected";
export interface ScenarioAssumptions {
  enrolment_delta_pct: number;
  staff_delta: number;
  fee_change_pct: number;
  cost_change_pct: number;
  periods_per_day: number;
  horizon_months: number;
}
export interface ScenarioResults {
  months: string[]; // "2026-11"
  revenue_paise: number[];
  cost_paise: number[];
  capacity_utilisation_pct: number[];
  teacher_load_hours: number[];
  risk_flags: string[];
  confidence_low_pct: number;
  confidence_high_pct: number;
}
export interface Scenario extends BaseRow {
  name: string;
  status: ScenarioStatus;
  is_baseline: boolean;
  assumptions: ScenarioAssumptions;
  results: ScenarioResults | null;
  rationale: string;
  created_by: string;
}

// ---------------------------------------------------------------- 0054 insights
export type InsightDomain = "attendance" | "academics" | "finance" | "admissions" | "operations" | "wellbeing" | "staff";
export type InsightSeverity = "info" | "watch" | "warning" | "critical";
export type InsightKind = "descriptive" | "diagnostic" | "predictive" | "prescriptive";
export type InsightStatus = "new" | "reviewing" | "actioned" | "resolved" | "dismissed";
export interface InsightExplanation {
  what: string;
  why: string;
  next_steps: string[];
  provider: "local" | "cloud";
  model: string;
  explained_at: ISODate;
}
export interface Insight extends BaseRow {
  title: string;
  domain: InsightDomain;
  severity: InsightSeverity;
  kind: InsightKind;
  pattern: string;
  evidence: { label: string; value: number; unit?: string }[];
  sources: string[];
  date_from: ISODate;
  date_to: ISODate;
  confidence: number; // 0–1
  factors: { label: string; weight: number }[]; // hypotheses, weights sum ≤ 1
  reviewer_role: string;
  recommended_actions: string[];
  approval_required: boolean;
  status: InsightStatus;
  entity_ref: { type: "section" | "student" | "staff" | "route" | "fee_structure" | "department"; id: Id; label: string } | null;
  signal?: string; // M19 CONTRACT
  detector_version?: number; // M19 CONTRACT
  explanation?: InsightExplanation | null; // M19 CONTRACT
}
export interface InsightAction extends BaseRow {
  insight_id: Id;
  action: string;
  owner: string;
  rationale: string;
  expected_outcome: string;
  actual_outcome: string | null;
  decided_at: ISODate;
  measured_at: ISODate | null;
  status: "planned" | "done" | "measured";
}

// ---------------------------------------------------------------- 0055 agents
export type RiskClass = "read_only" | "low_risk_reversible" | "user_confirmed" | "human_approved" | "prohibited";
export type AgentModelTier = "local" | "cloud_small" | "cloud_large";
export interface AgentDefinition extends BaseRow {
  slug: string;
  name: string;
  role_description: string;
  tools: string[];
  permissions: string[];
  model_tier: AgentModelTier;
  max_risk_class: RiskClass;
  is_enabled: boolean;
  quality_score: number | null; // 0–100
  cost_paise_30d: number;
  runs_30d: number;
  error_rate_pct: number;
}
export type AgentRunStatus = "queued" | "running" | "awaiting_approval" | "done" | "failed" | "rejected";
export interface AgentRun extends BaseRow {
  agent_id: Id;
  workflow_run_id: Id | null;
  task: string;
  risk_class: RiskClass;
  status: AgentRunStatus;
  started_at: ISODate;
  finished_at: ISODate | null;
  approver: string | null;
  cost_paise: number;
  summary: string;
  log: { at: ISODate; level: "info" | "warn" | "error"; text: string }[];
}

// ---------------------------------------------------------------- 0056 workflows
export type WorkflowNodeType = "trigger" | "condition" | "agent" | "tool" | "approval" | "notify" | "end";
export interface WorkflowNode {
  id: Id;
  type: WorkflowNodeType;
  label: string;
  config: Record<string, string>;
  x?: number;
  y?: number;
}
export interface GraphEdge {
  source: Id;
  target: Id;
  label?: string;
}
export interface Workflow extends BaseRow {
  name: string;
  version: number;
  status: "draft" | "active" | "paused" | "disabled";
  trigger: { type: "schedule" | "event" | "manual"; config: string };
  nodes: WorkflowNode[];
  edges: GraphEdge[];
  created_by: string;
}
export interface WorkflowRun extends BaseRow {
  workflow_id: Id;
  status: "running" | "awaiting_approval" | "done" | "failed" | "paused";
  started_at: ISODate;
  finished_at: ISODate | null;
  steps: { node_id: Id; status: "pending" | "running" | "done" | "failed" | "skipped"; at: ISODate; note?: string }[];
}

// ---------------------------------------------------------------- 0057 studio
export type StudioStatus = "submitted" | "analysing" | "proposed" | "approved" | "building" | "review" | "delivered" | "rejected";
export type BudgetRange = "under_50k" | "50k_2l" | "2l_10l" | "above_10l" | "unknown";
export interface StudioRequest extends BaseRow {
  title: string;
  problem: string;
  desired_outcome: string;
  user_roles: string[];
  existing_systems: string[];
  integrations: string[];
  constraints: string;
  budget_range: BudgetRange;
  timeline: string;
  success_criteria: string;
  status: StudioStatus;
  requested_by: string;
}
export type StudioResolution = "existing_feature" | "configuration" | "combine_modules" | "integration" | "new_module" | "platform_change";
export type PipelineStage = "research" | "architect" | "code" | "test" | "security" | "review" | "deploy";
export interface StudioProposal extends BaseRow {
  request_id: Id;
  version: number;
  resolution: StudioResolution;
  interpretation: string;
  clarifying_questions: string[];
  features: string[];
  workflows: string[];
  ux_outline: string[];
  technical_requirements: string[];
  integration_requirements: string[];
  permission_requirements: string[];
  cost_estimate_paise: number;
  timeline_weeks: number;
  risks: string[];
  acceptance_criteria: string[];
  pipeline: { stage: PipelineStage; status: "pending" | "running" | "done" | "failed"; agent?: string; note?: string }[];
  /** Static demo markup for the sandboxed preview iframe (sandbox="", no scripts). Never model-written. */
  preview_html: string | null;
}

// ---------------------------------------------------------------- 0058 personal (user-scoped, no institution_id)
export interface PersonalMemory {
  id: Id;
  user_id: Id;
  kind: "preference" | "goal" | "fact" | "project" | "context";
  content: string;
  source: "user" | "inferred";
  is_shared_with_institution: boolean;
  retain_until: ISODate | null;
  created_at: ISODate;
  updated_at: ISODate;
}
export interface PersonalGoal {
  id: Id;
  user_id: Id;
  title: string;
  progress_pct: number;
  due_date: ISODate | null;
  tasks: { id: Id; title: string; done: boolean }[];
  created_at: ISODate;
  updated_at: ISODate;
}
export interface WorkspaceSummary {
  id: Id;
  kind: "personal" | "institution" | "business" | "household";
  name: string;
  role: string | null;
  memory_count: number;
  is_current: boolean;
}

// ---------------------------------------------------------------- 0059 connectors
export type ConnectorStatus = "healthy" | "degraded" | "failed" | "disconnected";
export interface Connector extends BaseRow {
  slug: string;
  name: string;
  kind: "api" | "webhook" | "file" | "read_only" | "read_write";
  provider: string;
  scopes: string[];
  status: ConnectorStatus;
  last_sync_at: ISODate | null;
  records_synced: number;
  owner: string;
}
export interface ConnectorSync extends BaseRow {
  connector_id: Id;
  started_at: ISODate;
  finished_at: ISODate | null;
  status: "ok" | "partial" | "failed";
  records: number;
  errors: string[];
}
export interface DataQualityScore {
  entity: string;
  score: number; // 0–100
  issues: { kind: "missing" | "duplicate" | "stale" | "invalid"; count: number }[];
}
export interface LineageNode {
  id: Id;
  label: string;
  type: "source" | "table" | "metric" | "report" | "widget";
  x?: number;
  y?: number;
}

// ---------------------------------------------------------------- 0060 twin
export type TwinNodeType =
  | "student_group" | "teacher" | "department" | "room" | "building"
  | "route" | "vehicle" | "workflow" | "resource" | "budget_line";
export interface TwinNode {
  id: Id;
  type: TwinNodeType;
  label: string;
  capacity?: number;
  load?: number;
  utilisation_pct?: number;
  x?: number;
  y?: number;
}
export interface TwinEdge extends GraphEdge {
  relation: "teaches" | "uses" | "belongs_to" | "depends_on" | "transports" | "funds";
  weight?: number;
}
export interface TwinSnapshot extends BaseRow {
  as_of: ISODate;
  state: "historical" | "current" | "scenario";
  scenario_id: Id | null;
  nodes: TwinNode[];
  edges: TwinEdge[];
}
export interface ChangeImpact {
  changed_node_id: Id;
  affected: { node_id: Id; effect: string; severity: InsightSeverity }[];
}

// ---------------------------------------------------------------- 0061 dashboard layouts
export interface DashboardLayout {
  id: Id;
  user_id: Id;
  institution_id: Id;
  role: string;
  widget_order: string[];
  hidden: string[];
  updated_at: ISODate;
}

// ---------------------------------------------------------------- derived: command centre
export interface DailyBrief {
  role: string;
  date: ISODate;
  headline: string;
  items: { text: string; insight_id?: Id; href?: string }[];
  generated_by: "fixture" | "local_model";
}
export interface PriorityAction {
  id: Id;
  title: string;
  why: string;
  href: string;
  owner: string;
  due: ISODate;
  severity: InsightSeverity;
}
export interface ForecastCard {
  metric: string;
  current: number;
  forecast: number;
  unit: "count" | "pct" | "paise";
  confidence: number;
  direction: "up" | "flat" | "down";
}
export interface RiskIndicator {
  id: Id;
  label: string;
  level: InsightSeverity;
  trend: "up" | "flat" | "down";
  insight_id: Id | null;
}

// ---------------------------------------------------------------- derived: learning
export interface MasteryCell {
  section_id: Id;
  section_label: string;
  subject: string;
  topic_id: Id;
  topic: string;
  mastery_pct: number;
  students_below_threshold: number;
}
export interface CurriculumCoverage {
  subject: string;
  section_label: string;
  planned_units: number;
  completed_units: number;
  on_track: boolean;
}
export interface AssessmentPlanItem {
  id: Id;
  title: string;
  subject: string;
  section_label: string;
  date: ISODate;
  kind: "unit_test" | "term_exam" | "practical" | "quiz";
  status: "planned" | "scheduled" | "marked" | "published";
}

// ---------------------------------------------------------------- derived: student success
export interface StudentSuccessRow {
  student_id: Id;
  name: string;
  section_label: string;
  attendance_pct: number;
  mastery_pct: number;
  trend: "up" | "flat" | "down";
  risk: "none" | "watch" | "support";
  support_owner: string | null;
  last_contact: ISODate | null;
  flags: string[];
  gaps: { subject: string; topic: string; mastery_pct: number }[];
}
export interface InterventionPlan {
  id: Id;
  student_id: Id;
  owner: string;
  goal: string;
  steps: { title: string; due: ISODate; done: boolean }[];
  status: "proposed" | "active" | "review" | "closed";
  review_date: ISODate;
  restricted: true; // wellbeing records: counsellor/principal only (vision §11.11)
}

// ---------------------------------------------------------------- derived: operations
export interface TimetableConflict {
  id: Id;
  day: string;
  period: number;
  kind: "teacher_double_booked" | "room_double_booked" | "teacher_unavailable" | "room_capacity";
  entities: string[];
  suggestion: string;
}
export interface TeacherWorkload {
  staff_id: Id;
  name: string;
  periods_week: number;
  max_periods: number;
  subjects: string[];
  sections: string[];
  leave_dates: ISODate[];
}
export interface TransportRoute {
  id: Id;
  name: string;
  vehicle: string;
  driver: string;
  stops: { name: string; eta: string; students: number; x: number; y: number }[];
  status: "on_time" | "delayed" | "off_road";
  capacity: number;
  assigned: number;
}
export interface MaintenanceRequest {
  id: Id;
  asset: string;
  location: string;
  issue: string;
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "done";
  raised_at: ISODate;
  assignee: string | null;
}
export interface RoomUtilisation {
  room: string;
  capacity: number;
  periods_used: number;
  periods_total: number;
}

// ---------------------------------------------------------------- derived: finance intelligence
export interface FinanceForecastPoint {
  month: string; // "2026-11"
  collected_paise: number;
  expected_paise: number;
  forecast_low_paise: number;
  forecast_high_paise: number;
}
export interface OutstandingAlert {
  student_id: Id;
  name: string;
  section_label: string;
  outstanding_paise: number;
  days_overdue: number;
  last_reminder: ISODate | null;
  concession: boolean;
}
export interface BudgetLine {
  category: string;
  budget_paise: number;
  actual_paise: number;
  variance_pct: number;
}

// ---------------------------------------------------------------- derived: trust & governance
export interface AuditEventRow {
  id: Id;
  institution_id: Id;
  actor: string;
  actor_role: string;
  event: string;
  entity: string;
  entity_id: Id;
  at: ISODate;
  summary: string;
}
export interface ModelRegistryEntry {
  id: Id;
  provider: string;
  model: string;
  tier: "local" | "cloud";
  version: string;
  cost_per_1k_in_paise: number;
  cost_per_1k_out_paise: number;
  latency_ms_p50: number;
  eval_score: number | null;
  status: "active" | "fallback" | "retired";
}
export interface ConsentRecord {
  id: Id;
  user_label: string;
  subject: string;
  purpose: string;
  granted: boolean;
  at: ISODate;
  expires_at: ISODate | null;
}
export interface PermissionReview {
  id: Id;
  member: string;
  role: string;
  extra_permissions: string[];
  last_reviewed: ISODate | null;
  due: ISODate;
  status: "due" | "reviewed" | "revoked";
}
