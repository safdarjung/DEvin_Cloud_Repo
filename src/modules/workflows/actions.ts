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
import { createClient } from "@/lib/supabase/server";
import { parseGraph, triggerColumns } from "@/modules/workflows/graph";
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

export const saveWorkflow = defineAction({
  name: "workflow.save",
  module: "workflows",
  schema: WorkflowSaveSchema,
  permission: "workflow.manage",
  handler: async ({ id, name, nodes, edges }: WorkflowSaveInput, ctx) => {
    const parsed = parseGraph({ nodes, edges });
    if (!parsed.ok) {
      throw new AppError("validation_failed", "This workflow graph is not valid.", { graph: parsed.errors });
    }
    const { trigger_type, trigger_config } = triggerColumns(parsed.graph);

    const supabase = await createClient();
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

    return { id: data.id as string, version: data.version as number, status: data.status as string };
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
        throw new AppError("validation_failed", "This workflow graph is not valid.", { graph: parsed.errors });
      }
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
// lifecycle"). Both are thin RPC wrappers: `start_workflow_run` and
// `decide_workflow_run` already raise/enforce not_found, forbidden,
// invalid_state, validation_failed and write the audit row themselves
// (0096 part 2), so the handlers only call mapSqlError and shape the
// return value — same split as student-leave/actions.ts's decide wrapper.
export const runWorkflowNow = defineAction({
  name: "workflow.runNow",
  module: "workflows",
  schema: WorkflowRunNowSchema,
  permission: "workflow.manage",
  handler: async ({ id }: WorkflowRunNowInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("start_workflow_run", { p_workflow_id: id });
    if (error) throwMapped(error);
    return { runId: data as string };
  },
});

export const decideWorkflowRun = defineAction({
  name: "workflow.run.decide",
  module: "workflows",
  schema: WorkflowDecideSchema,
  permission: "workflow.manage",
  handler: async ({ runId, decision, note }: WorkflowDecideInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("decide_workflow_run", {
      p_run_id: runId,
      p_decision: decision,
      ...(note !== undefined ? { p_note: note } : {}),
    });
    if (error) throwMapped(error);
    const run = data as { id: string; status: string };
    return { runId: run.id, status: run.status };
  },
});
