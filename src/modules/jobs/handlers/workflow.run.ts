// M23-T12 — job handler `workflow.run` (M23-tasks.md rulings "Handler").
// Payload `{ run_id }` (`WorkflowRunJobPayloadSchema`, strict). Plain node:
// relative `.ts` value imports; `@/` only for types.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { isModuleEnabled } from "../../../lib/modules/catalog.ts";
import { parseGraph, stepCount } from "../../workflows/graph.ts";
import { runWorkflow, type EngineStart } from "../../workflows/engine.ts";
import { createEnginePorts } from "../../workflows/ports.ts";
import { WORKFLOW_ENGINE_VERSION, WorkflowRunJobPayloadSchema } from "../../workflows/schemas.ts";
import type { JobHandler } from "../types.ts";

type RunRow = {
  id: string;
  institution_id: string;
  workflow_id: string;
  status: string;
  graph: unknown;
  steps: unknown;
  cursor_node_id: string | null;
  pending_decision: string | null;
  last_value: number | null;
  entity_id: string | null;
};

async function failRun(admin: SupabaseClient<Database>, run: RunRow, note: string, now: Date): Promise<void> {
  const steps = [...((run.steps as unknown[]) ?? []), { node_id: "_run", status: "failed", at: now.toISOString(), note }];
  const { error } = await admin
    .from("workflow_runs")
    .update({ status: "failed", steps: steps as unknown as NonNullable<Json>, finished_at: now.toISOString(), pending_decision: null })
    .eq("id", run.id)
    .eq("status", "running");
  if (error) throw error;
}

export const workflowRun: JobHandler = async (job, { admin }) => {
  const payload = WorkflowRunJobPayloadSchema.safeParse(job.payload);
  if (!payload.success) throw new Error("invalid_payload");
  if (!job.institution_id) throw new Error("workflow.run: missing institution_id");

  // 1. Idempotent: missing or already past `running` → nothing to do (lesson 11).
  const { data: run, error: runError } = await admin
    .from("workflow_runs")
    .select("id, institution_id, workflow_id, status, graph, steps, cursor_node_id, pending_decision, last_value, entity_id")
    .eq("id", payload.data.run_id)
    .eq("institution_id", job.institution_id)
    .maybeSingle();
  if (runError) throw runError;
  if (!run || run.status !== "running") return;

  // 2. Module off → feature off.
  const { data: institution, error: institutionError } = await admin
    .from("institutions")
    .select("settings")
    .eq("id", run.institution_id)
    .single();
  if (institutionError) throw institutionError;
  const settings = (institution.settings as Record<string, unknown> | null) ?? {};
  if (!isModuleEnabled({ institution: { settings } }, "workflows")) return;

  const { data: workflow, error: workflowError } = await admin
    .from("workflows")
    .select("name, created_by")
    .eq("id", run.workflow_id)
    .eq("institution_id", run.institution_id)
    .single();
  if (workflowError) throw workflowError;

  const now = new Date();

  // 3. The stored snapshot must still parse; a hand-made or corrupted graph fails the run, not the job.
  const parsed = parseGraph(run.graph as { nodes: unknown; edges: unknown });
  if (!parsed.ok) {
    await failRun(admin, run as RunRow, "Invalid workflow graph", now);
    return;
  }
  // An empty workflow (trigger -> end) is never run, however it was activated.
  if (stepCount([...parsed.graph.nodes.values()]) === 0) {
    await failRun(admin, run as RunRow, "This workflow has no steps", now);
    return;
  }

  // 4. Resume an awaiting-approval decision, or start fresh from the trigger.
  const start: EngineStart = run.pending_decision
    ? {
        kind: "resume",
        nodeId: run.cursor_node_id as string,
        decision: run.pending_decision as "approved" | "rejected",
        lastValue: run.last_value,
      }
    : { kind: "trigger" };

  // 5. Walk the graph through the real ports.
  const ports = createEnginePorts(
    admin,
    { id: run.id, institution_id: run.institution_id, entity_id: run.entity_id },
    { name: workflow.name, created_by: workflow.created_by },
    settings,
    () => now,
  );
  const result = await runWorkflow(parsed.graph, start, ports);

  // 6. One write at the end; appended steps, never replaced. A lost race (0 rows) means another attempt already finished it.
  const { error: updateError } = await admin
    .from("workflow_runs")
    .update({
      status: result.status,
      steps: [...((run.steps as unknown[]) ?? []), ...result.steps] as unknown as NonNullable<Json>,
      cursor_node_id: result.cursorNodeId,
      last_value: result.lastValue,
      pending_decision: null,
      engine_version: WORKFLOW_ENGINE_VERSION,
      finished_at: result.status === "done" || result.status === "failed" ? now.toISOString() : null,
    })
    .eq("id", run.id)
    .eq("status", "running");
  if (updateError) throw updateError;
};
