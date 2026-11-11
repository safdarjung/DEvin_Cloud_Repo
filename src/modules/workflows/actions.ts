"use server";

// M23-T15 — workflow.save / workflow.setStatus (M23-tasks.md rulings
// "Actions", "ErrorCode map"). Insert/update-by-id + 23505 name-conflict
// mapping mirrors timetable/actions.ts's upsertRoom; setStatus mirrors
// reports/actions.ts's setScheduledReportStatus. The write guard (0096
// app.guard_workflow_write) raises code:invalid_state for a graph edit
// while active and code:validation_failed when an activated schedule
// never fires; both get the friendlier message the rulings specify.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { CUSTOM_AGENT_SLUG_RE } from "@/modules/agents/catalog";
import { workflowAgentOptions } from "@/modules/agents/queries";
import { getTodaySectionsForTeacher } from "@/modules/attendance/queries";
import type { WorkflowRun } from "@/modules/fabric/types";
import { runJobNow } from "@/modules/jobs/runner";
import { createJobsAdminClient } from "@/modules/jobs/with-service-role";
import { stepErrorsFromGraph } from "@/modules/workflows/form-graph";
import { parseGraph, stepCount, triggerColumns, type ParsedGraph } from "@/modules/workflows/graph";
import {
  WorkflowDecideSchema,
  WorkflowRunNowSchema,
  WorkflowSaveSchema,
  WorkflowStatusSchema,
  type WorkflowDecideInput,
  type WorkflowRunNowInput,
  type WorkflowSaveInput,
  type WorkflowStatusInput,
} from "@/modules/workflows/schemas";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION);
}

const NO_STEPS = "Add at least one step first. A workflow with no steps can only be saved as a draft.";
const noSteps = () => new AppError("validation_failed", NO_STEPS, { steps: [NO_STEPS] });

/** Field key for a node's errors: form nodes are s1..sN (form-graph.ts); other shapes report under `graph`. */
const nodeKey = (nodeId: string): string => {
  const m = /^s(\d+)$/.exec(nodeId);
  return m ? `steps.${Number(m[1]) - 1}` : "graph";
};

/** Sections and custom agents a graph names must be this school's (live) ones; read through their owner modules under RLS. */
async function checkReferences(ctx: TenantContext, graph: ParsedGraph): Promise<void> {
  const nodes = [...graph.nodes.values()];
  const sectionIds = nodes.flatMap((n) => (n.type === "condition" && n.config.section ? [n.config.section] : []));
  const customSlugs = nodes.flatMap((n) => (n.type === "agent" && CUSTOM_AGENT_SLUG_RE.test(n.config.agent) ? [n.config.agent] : []));
  const sections = new Set(sectionIds.length ? (await getTodaySectionsForTeacher(ctx)).map((s) => s.id) : []);
  const agents = new Set(customSlugs.length ? (await workflowAgentOptions(ctx)).map((a) => a.slug) : []);

  const errors: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.type === "condition" && n.config.section && !sections.has(n.config.section)) {
      (errors[`${nodeKey(n.id)}.section`] ??= []).push("Pick a section of this school.");
    }
    if (n.type === "agent" && CUSTOM_AGENT_SLUG_RE.test(n.config.agent) && !agents.has(n.config.agent)) {
      (errors[`${nodeKey(n.id)}.agent`] ??= []).push("This agent was deleted or is not this school's. Pick another.");
    }
  }
  if (Object.keys(errors).length) throw new AppError("validation_failed", "Some steps point at something this school does not have.", errors);
}

export interface WorkflowRunResult {
  runId: string;
  status: WorkflowRun["status"];
  steps: WorkflowRun["steps"];
  startedAt: string;
  finishedAt: string | null;
  /** True when the run did not finish in this request: the job runner continues it (result shows under Runs). */
  queued: boolean;
}

// No scheduler is guaranteed (Vercel Hobby cron is daily): run the run's own
// workflow.run job in this request through the existing `jobs` service-role
// caller (07 §4, same as safety/actions.ts). Bounded: a run walks at most
// 30 nodes (WorkflowSaveSchema; engine MAX_STEPS) and the timeout below; on
// timeout/failure the job is left queued and the runner is the retry path.
const IN_REQUEST_RUN_MS = 15_000;

async function runInRequest(institutionId: string, runId: string, idempotencyKey: string): Promise<WorkflowRunResult> {
  let deferred = false;
  try {
    await runJobNow(createJobsAdminClient(), { institutionId, idempotencyKey, timeoutMs: IN_REQUEST_RUN_MS });
  } catch (err) {
    deferred = true;
    const code = (err as { code?: unknown } | null)?.code;
    console.error(`[${crypto.randomUUID()}] workflow run ${runId}: in-request run did not finish, job left queued`, {
      code: typeof code === "string" ? code : err instanceof Error ? err.name : "unknown",
    });
  }

  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from("workflow_runs")
    .select("status, steps, started_at, finished_at")
    .eq("id", runId)
    .eq("institution_id", institutionId)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!run) throw new AppError("not_found", "Workflow run not found.");
  const status = run.status as WorkflowRun["status"];
  return {
    runId,
    status,
    steps: run.steps as unknown as WorkflowRun["steps"],
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    queued: deferred || status === "running",
  };
}

export const saveWorkflow = defineAction({
  name: "workflow.save",
  module: "workflows",
  schema: WorkflowSaveSchema,
  permission: "workflow.manage",
  handler: async ({ id, name, nodes, edges }: WorkflowSaveInput, ctx) => {
    const parsed = parseGraph({ nodes, edges });
    if (!parsed.ok) {
      throw new AppError("validation_failed", "This workflow graph is not valid.", stepErrorsFromGraph(parsed.errors));
    }
    await checkReferences(ctx, parsed.graph);
    const { trigger_type, trigger_config } = triggerColumns(parsed.graph);
    const steps = stepCount(nodes);

    const supabase = await createClient();
    if (steps === 0 && id) {
      // New rows are always drafts (0096 guard); an existing one may lose its last step only while a draft.
      const { data: current, error: readError } = await supabase
        .from("workflows")
        .select("status")
        .eq("id", id)
        .eq("institution_id", ctx.institution.id)
        .maybeSingle();
      if (readError) throwMapped(readError);
      if (!current) throw new AppError("not_found", "Workflow not found.");
      if (current.status !== "draft") throw noSteps();
    }
    const row = { institution_id: ctx.institution.id, name, nodes, edges, trigger_type, trigger_config };
    const query = id
      ? supabase.from("workflows").update(row).eq("id", id).eq("institution_id", ctx.institution.id)
      : supabase.from("workflows").insert({ ...row, created_by: ctx.user.id });
    const { data, error } = await query.select("id, version, status").maybeSingle();
    if (error) {
      if (isUniqueViolation(error)) {
        throw new AppError("conflict", "A workflow with this name already exists.", { name: ["Name already in use."] });
      }
      const mapped = mapSqlError(error);
      if (!mapped.ok && mapped.error.code === "invalid_state") {
        throw new AppError("invalid_state", "Pause the workflow to edit it.");
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Workflow not found.");

    await audit(ctx, {
      action: "workflow.saved",
      entityType: "workflow",
      entityId: data.id as string,
      metadata: { id: data.id, version: data.version },
    });

    return { id: data.id as string, version: data.version as number, status: data.status as string, steps };
  },
});

export const setWorkflowStatus = defineAction({
  name: "workflow.setStatus",
  module: "workflows",
  schema: WorkflowStatusSchema,
  permission: "workflow.manage",
  handler: async ({ id, status }: WorkflowStatusInput, ctx) => {
    const supabase = await createClient();
    const { data: current, error: readError } = await supabase
      .from("workflows")
      .select("status, nodes, edges")
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!current) throw new AppError("not_found", "Workflow not found.");

    if (status === "active") {
      const parsed = parseGraph({ nodes: current.nodes, edges: current.edges });
      if (!parsed.ok) {
        throw new AppError("validation_failed", "This workflow graph is not valid.", stepErrorsFromGraph(parsed.errors));
      }
      if (stepCount([...parsed.graph.nodes.values()]) === 0) throw noSteps();
    }

    const { data, error } = await supabase
      .from("workflows")
      .update({ status })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id, status, next_run_at")
      .maybeSingle();
    if (error) {
      const mapped = mapSqlError(error);
      if (!mapped.ok && mapped.error.code === "validation_failed") {
        throw new AppError("validation_failed", "This schedule never fires.");
      }
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Workflow not found.");

    await audit(ctx, {
      action: "workflow.status",
      entityType: "workflow",
      entityId: data.id as string,
      metadata: { id: data.id, from: current.status, to: data.status },
    });

    return {
      id: data.id as string,
      status: data.status as string,
      nextRunAt: (data.next_run_at as string | null) ?? null,
    };
  },
});

// M23-T16 — workflow.runNow / workflow.run.decide (rulings "Actions", "Run
// lifecycle"). `start_workflow_run` and `decide_workflow_run` enforce
// not_found, forbidden, invalid_state, validation_failed and write the audit
// row themselves (0096 part 2). Both then run the queued workflow.run job in
// this request (runInRequest) and return the run as it stands.
export const runWorkflowNow = defineAction({
  name: "workflow.runNow",
  module: "workflows",
  schema: WorkflowRunNowSchema,
  permission: "workflow.manage",
  handler: async ({ id }: WorkflowRunNowInput, ctx): Promise<WorkflowRunResult> => {
    const supabase = await createClient();
    const { data: workflow, error: readError } = await supabase
      .from("workflows")
      .select("nodes")
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    if (!workflow) throw new AppError("not_found", "Workflow not found.");
    if (stepCount(workflow.nodes as unknown as { type: string }[]) === 0) throw noSteps();

    const { data, error } = await supabase.rpc("start_workflow_run", { p_workflow_id: id });
    if (error) throwMapped(error);
    const runId = data as string;
    return runInRequest(ctx.institution.id, runId, `workflow.run:${runId}:start`); // key set by app.create_workflow_run (0096)
  },
});

export const decideWorkflowRun = defineAction({
  name: "workflow.run.decide",
  module: "workflows",
  schema: WorkflowDecideSchema,
  permission: "workflow.manage",
  handler: async ({ runId, decision, note }: WorkflowDecideInput, ctx): Promise<WorkflowRunResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decide_workflow_run", {
      p_run_id: runId,
      p_decision: decision,
      ...(note !== undefined ? { p_note: note } : {}),
    });
    if (error) throwMapped(error);
    const run = data as { id: string; cursor_node_id: string };
    return runInRequest(ctx.institution.id, run.id, `workflow.run:${run.id}:${run.cursor_node_id}`); // key set by decide_workflow_run (0096)
  },
});
