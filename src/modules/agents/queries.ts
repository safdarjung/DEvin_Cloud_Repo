import "server-only";

// M22-T9 — agents.definitions / agents.runs / agents.runDetail. Mirrors
// src/modules/core/audit.queries.ts's actor-name-lookup pattern (profiles
// batch select by id). Rows are the only per-institution state (rulings
// "Catalog is code, not rows") — definition name/tools/risk always come
// from AGENT_CATALOG/ACTION_RISK, never a DB column.
import { createClient } from "@/lib/supabase/server";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import type { AgentDefinition, AgentRun, AgentRunStatus, RiskClass } from "@/modules/fabric/types";
import { AGENT_CATALOG, AGENT_SLUGS, agentMaxRisk, canDecideRun, type AgentProposal } from "./catalog";
import type { AgentRunDetailInput, AgentRunsQueryInput } from "./schemas";
import { ensureAgentDefinitions } from "./service-role";
import { agentPermissions } from "./tools";

// shortcut: fixed ₹84/USD for an estimate label; local runs cost 0; upgrade
// to a settings rate when a cloud agent path exists (rulings "Fixture mapping").
const USD_TO_PAISE = 8_400;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
// shortcut: TS sums under the 1000-row max_rows; move to SQL if runs_30d nears it.
const MAX_ROWS = 1000;

// Mirrors website/queries.ts, finance/queries.ts: map a raw SQL error to its
// ErrorCode (conflict/forbidden/...) instead of a bare "internal" (review LOW).
function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export interface AgentRunDetail {
  run: AgentRun;
  proposals: AgentProposal[];
  requestedBy: string;
  decisionNote: string | null;
  canDecide: boolean;
}

export async function agentDefinitions(ctx: TenantContext): Promise<AgentDefinition[]> {
  await ensureAgentDefinitions(ctx.institution.id);
  const supabase = await createClient();

  const { data: defRows, error: defError } = await supabase
    .from("agent_definitions")
    .select("id, slug, is_enabled, created_at, updated_at")
    .eq("institution_id", ctx.institution.id);
  if (defError) throwMapped(defError);
  const bySlug = new Map((defRows ?? []).map((row) => [row.slug, row]));

  const since = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  const { data: runRows, error: runError } = await supabase
    .from("agent_runs")
    .select("id, agent_id, status")
    .eq("institution_id", ctx.institution.id)
    .gte("created_at", since)
    .limit(MAX_ROWS);
  if (runError) throwMapped(runError);

  const agentIdByRunId = new Map<string, string>();
  const statsByAgentId = new Map<string, { total: number; failed: number; costUsd: number }>();
  for (const run of runRows ?? []) {
    agentIdByRunId.set(run.id, run.agent_id);
    const stat = statsByAgentId.get(run.agent_id) ?? { total: 0, failed: 0, costUsd: 0 };
    stat.total += 1;
    if (run.status === "failed") stat.failed += 1;
    statsByAgentId.set(run.agent_id, stat);
  }

  const { data: usageRows, error: usageError } = await supabase
    .from("ai_usage_events")
    .select("agent_run_id, cost_estimate_usd")
    .eq("institution_id", ctx.institution.id)
    .not("agent_run_id", "is", null)
    .gte("created_at", since)
    .limit(MAX_ROWS);
  if (usageError) throwMapped(usageError);
  for (const usage of usageRows ?? []) {
    const agentId = usage.agent_run_id ? agentIdByRunId.get(usage.agent_run_id) : undefined;
    const stat = agentId ? statsByAgentId.get(agentId) : undefined;
    if (stat) stat.costUsd += usage.cost_estimate_usd;
  }

  const permissionsBySlug = new Map(
    await Promise.all(AGENT_SLUGS.map(async (slug) => [slug, await agentPermissions(slug)] as const)),
  );

  return AGENT_SLUGS.map((slug) => {
    const spec = AGENT_CATALOG[slug];
    const defRow = bySlug.get(slug);
    if (!defRow) throw new AppError("internal", `Missing agent definition row for ${slug}.`);
    const stat = statsByAgentId.get(defRow.id) ?? { total: 0, failed: 0, costUsd: 0 };
    return {
      id: defRow.id,
      institution_id: ctx.institution.id,
      created_at: defRow.created_at,
      updated_at: defRow.updated_at,
      slug,
      name: spec.name,
      role_description: spec.roleDescription,
      tools: Object.keys(spec.tools),
      permissions: permissionsBySlug.get(slug) ?? [],
      model_tier: "local",
      max_risk_class: agentMaxRisk(slug),
      is_enabled: defRow.is_enabled,
      quality_score: null,
      cost_paise_30d: Math.round(stat.costUsd * USD_TO_PAISE),
      runs_30d: stat.total,
      error_rate_pct: stat.total > 0 ? Math.round((100 * stat.failed) / stat.total) : 0,
    };
  });
}

interface RunRow {
  id: string;
  institution_id: string;
  agent_id: string;
  workflow_run_id: string | null;
  task: string;
  risk_class: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  summary: string;
  log: unknown;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
}

// Batch-hydrates raw rows into AgentRun (approver name, cost_paise) —
// shared by agentRuns (list) and agentRunDetail (single row).
async function hydrateRuns(ctx: TenantContext, rows: RunRow[]): Promise<AgentRun[]> {
  if (rows.length === 0) return [];
  const supabase = await createClient();

  const decidedByIds = [...new Set(rows.map((r) => r.decided_by).filter((id): id is string => id !== null))];
  const approverNames = new Map<string, string>();
  if (decidedByIds.length > 0) {
    const { data: profiles, error } = await supabase.from("profiles").select("id, full_name").in("id", decidedByIds);
    if (error) throwMapped(error);
    for (const p of profiles ?? []) {
      if (p.full_name) approverNames.set(p.id, p.full_name);
    }
  }

  const runIds = rows.map((r) => r.id);
  const costByRunId = new Map<string, number>();
  // shortcut: TS sums under the 1000-row max_rows; move to SQL if runs_30d nears it.
  const { data: usageRows, error: usageError } = await supabase
    .from("ai_usage_events")
    .select("agent_run_id, cost_estimate_usd")
    .eq("institution_id", ctx.institution.id)
    .in("agent_run_id", runIds)
    .limit(MAX_ROWS);
  if (usageError) throwMapped(usageError);
  for (const usage of usageRows ?? []) {
    if (!usage.agent_run_id) continue;
    costByRunId.set(usage.agent_run_id, (costByRunId.get(usage.agent_run_id) ?? 0) + usage.cost_estimate_usd);
  }

  return rows.map((row) => ({
    id: row.id,
    institution_id: row.institution_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    agent_id: row.agent_id,
    workflow_run_id: row.workflow_run_id,
    task: row.task,
    risk_class: row.risk_class as RiskClass,
    status: row.status as AgentRunStatus,
    started_at: row.started_at ?? row.created_at,
    finished_at: row.finished_at,
    approver: row.decided_by ? approverNames.get(row.decided_by) ?? null : null,
    cost_paise: Math.round((costByRunId.get(row.id) ?? 0) * USD_TO_PAISE),
    summary: row.summary,
    log: row.log as AgentRun["log"],
  }));
}

const RUN_COLUMNS =
  "id, institution_id, agent_id, workflow_run_id, task, risk_class, status, started_at, finished_at, summary, log, decided_by, created_at, updated_at";

export async function agentRuns(ctx: TenantContext, input: AgentRunsQueryInput): Promise<AgentRun[]> {
  const supabase = await createClient();
  let query = supabase
    .from("agent_runs")
    .select(`${RUN_COLUMNS}, agent_definitions!inner(slug)`)
    .eq("institution_id", ctx.institution.id)
    .order("created_at", { ascending: false })
    .limit(input.limit);

  if (input.slug) query = query.eq("agent_definitions.slug", input.slug);
  if (input.status) query = query.eq("status", input.status);

  const { data, error } = await query;
  if (error) throwMapped(error);
  return hydrateRuns(ctx, data ?? []);
}

export async function agentRunDetail(ctx: TenantContext, input: AgentRunDetailInput): Promise<AgentRunDetail> {
  const supabase = await createClient();
  const { data: row, error } = await supabase
    .from("agent_runs")
    .select(`${RUN_COLUMNS}, proposals, decision_note, requested_by`)
    .eq("institution_id", ctx.institution.id)
    .eq("id", input.runId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!row) throw new AppError("not_found", "Agent run not found.");

  const [run] = await hydrateRuns(ctx, [row]);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", row.requested_by)
    .maybeSingle();
  if (profileError) throwMapped(profileError);

  return {
    run,
    proposals: (row.proposals as unknown as AgentProposal[]) ?? [],
    requestedBy: profile?.full_name ?? "",
    decisionNote: row.decision_note,
    canDecide: canDecideRun(
      { userId: ctx.user.id, canApprove: hasPermission(ctx, "agent.approve") },
      { risk_class: row.risk_class as RiskClass, requested_by: row.requested_by },
    ),
  };
}
