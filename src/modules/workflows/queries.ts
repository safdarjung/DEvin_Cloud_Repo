import "server-only";

// M23-T17 — workflows.list / workflows.runs. Mirrors
// src/modules/agents/queries.ts's actor-name-lookup pattern (profiles
// batch select by id) for workflows.created_by; keys match
// src/modules/fabric/types.ts's Workflow/WorkflowRun exactly (fixture
// parity, rulings "query return types equal types.ts exactly").
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { Workflow, WorkflowRun } from "@/modules/fabric/types";
import type { WorkflowListInput, WorkflowRunsInput } from "./schemas";

const WORKFLOW_COLUMNS =
  "id, institution_id, name, version, status, trigger_type, trigger_config, nodes, edges, created_by, created_at, updated_at";

export async function workflowList(ctx: TenantContext, input: WorkflowListInput): Promise<Workflow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("workflows")
    .select(WORKFLOW_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .order("name");

  if (input.status) query = query.eq("status", input.status);

  const { data, error } = await query;
  if (error) throw error;
  const rows = data ?? [];

  const creatorIds = [...new Set(rows.map((row) => row.created_by))];
  const creatorNames = new Map<string, string>();
  if (creatorIds.length > 0) {
    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", creatorIds);
    if (profileError) throw profileError;
    for (const profile of profiles ?? []) {
      if (profile.full_name) creatorNames.set(profile.id, profile.full_name);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    institution_id: row.institution_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    name: row.name,
    version: row.version,
    status: row.status as Workflow["status"],
    trigger: { type: row.trigger_type as Workflow["trigger"]["type"], config: row.trigger_config },
    nodes: row.nodes as unknown as Workflow["nodes"],
    edges: row.edges as unknown as Workflow["edges"],
    created_by: creatorNames.get(row.created_by) ?? "",
  }));
}

const RUN_COLUMNS = "id, institution_id, workflow_id, status, started_at, finished_at, steps, created_at, updated_at";

export async function workflowRuns(ctx: TenantContext, input: WorkflowRunsInput): Promise<WorkflowRun[]> {
  const supabase = await createClient();
  let query = supabase
    .from("workflow_runs")
    .select(RUN_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .order("started_at", { ascending: false })
    .limit(input.limit);

  if (input.workflowId) query = query.eq("workflow_id", input.workflowId);
  if (input.status) query = query.eq("status", input.status);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    institution_id: row.institution_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    workflow_id: row.workflow_id,
    status: row.status as WorkflowRun["status"],
    started_at: row.started_at,
    finished_at: row.finished_at,
    steps: row.steps as unknown as WorkflowRun["steps"],
  }));
}
