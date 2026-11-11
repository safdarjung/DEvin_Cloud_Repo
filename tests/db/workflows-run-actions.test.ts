import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 lead review pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { decideWorkflowRun, runWorkflowNow } from "@/modules/workflows/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions, type TestInstitution } from "../helpers/roles";

// M23-T16 — workflow.runNow / workflow.run.decide (M23-tasks.md rulings
// "Actions", "Run lifecycle"). Both actions are thin RPC wrappers around
// 0096 part 2's start_workflow_run / decide_workflow_run, which already
// enforce not_found/forbidden/invalid_state and write the audit row —
// fixture setup (workflow + awaiting run) mirrors workflows-lifecycle.test.ts.
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

// trigger -> approval n2 -> end (approved) / e2 (rejected): a real graph, so
// the in-request run walks it (start -> awaiting_approval; decide -> done).
const NODES = [
  { id: "t", type: "trigger", label: "Start", config: { kind: "manual" } },
  { id: "n2", type: "approval", label: "OK?", config: { prompt: "Go ahead?" } },
  { id: "e", type: "end", label: "End", config: {} },
  { id: "e2", type: "end", label: "End", config: {} },
];
const EDGES = [
  { source: "t", target: "n2" },
  { source: "n2", target: "e", label: "approved" },
  { source: "n2", target: "e2", label: "rejected" },
];

function workflowRow(institutionId: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  return {
    institution_id: institutionId,
    name: `Workflow ${crypto.randomUUID().slice(0, 8)}`,
    created_by: createdBy,
    nodes: NODES,
    edges: EDGES,
    status: "active",
    trigger_type: "schedule",
    trigger_config: "0 9 * * 1",
    ...overrides,
  };
}

async function insertWorkflow(inst: TestInstitution, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("workflows")
    .insert(workflowRow(inst.institutionId, inst.users.principal.id, overrides))
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("workflow insert failed");
  return data as { id: string };
}

async function insertAwaitingRun(inst: TestInstitution, workflowId: string): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("workflow_runs")
    .insert({
      institution_id: inst.institutionId,
      workflow_id: workflowId,
      workflow_version: 1,
      graph: { nodes: NODES, edges: EDGES },
      trigger_kind: "manual",
      trigger_key: `manual:${crypto.randomUUID()}`,
      status: "awaiting_approval",
      cursor_node_id: "n2",
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("run insert failed");
  return data as { id: string };
}

async function jobForRun(runId: string) {
  return sql`select * from public.jobs where type = 'workflow.run' and payload ->> 'run_id' = ${runId}`;
}

describe("workflow run actions (M23-T16)", () => {
  it("runWorkflowNow: principal starts a schedule workflow, idempotent per minute, event/paused/role errors", async () => {
    const inst = await createTestInstitution("workflow-run-now");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const first = await callAs(inst, "principal", runWorkflowNow, { id: workflow.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.data.runId).toBeTruthy();
    // Ran in the request: walked to the approval step, no cron needed.
    expect(first.data.status).toBe("awaiting_approval");
    expect(first.data.queued).toBe(false);
    expect(first.data.steps.map((s) => s.node_id)).toEqual(["t", "n2"]);

    const jobs = await jobForRun(first.data.runId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("succeeded");

    // Same calendar minute -> same run id (idempotent click).
    const second = await callAs(inst, "principal", runWorkflowNow, { id: workflow.id });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.runId).toBe(first.data.runId);

    // Event-triggered workflow cannot be started manually.
    const eventWorkflow = await insertWorkflow(inst, { trigger_type: "event", trigger_config: "enquiry.received" });
    const eventRun = await callAs(inst, "principal", runWorkflowNow, { id: eventWorkflow.id });
    expect(eventRun.ok).toBe(false);
    if (eventRun.ok) return;
    expect(eventRun.error.code).toBe("invalid_state");

    // Paused workflow cannot be started.
    const pausedWorkflow = await insertWorkflow(inst, { status: "paused" });
    const pausedRun = await callAs(inst, "principal", runWorkflowNow, { id: pausedWorkflow.id });
    expect(pausedRun.ok).toBe(false);
    if (pausedRun.ok) return;
    expect(pausedRun.error.code).toBe("invalid_state");

    // Admin can read but not act.
    const asAdmin = await callAs(inst, "admin", runWorkflowNow, { id: workflow.id });
    expect(asAdmin.ok).toBe(false);
    if (asAdmin.ok) return;
    expect(asAdmin.error.code).toBe("forbidden");
  });

  it("runWorkflowNow: another institution's workflow id is not_found", async () => {
    await withTwoInstitutions(async (a, b) => {
      const workflowInB = await insertWorkflow(b);
      const crossInstitution = await callAs(a, "principal", runWorkflowNow, { id: workflowInB.id });
      expect(crossInstitution.ok).toBe(false);
      if (crossInstitution.ok) return;
      expect(crossInstitution.error.code).toBe("not_found");
    });
  });

  it("decideWorkflowRun: principal approves, second decision invalid_state, admin forbidden", async () => {
    const inst = await createTestInstitution("workflow-run-decide-approve");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const run = await insertAwaitingRun(inst, workflow.id);

    const approved = await callAs(inst, "principal", decideWorkflowRun, { runId: run.id, decision: "approve" });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    // The decision resumes the run in the request: approved -> end -> done.
    expect(approved.data).toMatchObject({ runId: run.id, status: "done", queued: false });
    expect(approved.data.steps.map((s) => [s.node_id, s.note])).toEqual([
      ["n2", "Approved"],
      ["e", "End"],
    ]);

    const jobs = await jobForRun(run.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe(`workflow.run:${run.id}:n2`);
    expect(jobs[0].status).toBe("succeeded");

    // Already decided -> a second decision is invalid_state.
    const again = await callAs(inst, "principal", decideWorkflowRun, { runId: run.id, decision: "approve" });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error.code).toBe("invalid_state");

    const awaiting2 = await insertAwaitingRun(inst, workflow.id);
    const asAdmin = await callAs(inst, "admin", decideWorkflowRun, { runId: awaiting2.id, decision: "approve" });
    expect(asAdmin.ok).toBe(false);
    if (asAdmin.ok) return;
    expect(asAdmin.error.code).toBe("forbidden");
  });

  it("decideWorkflowRun: reject stores the note but the audit row never carries the note text", async () => {
    const inst = await createTestInstitution("workflow-run-decide-reject");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const run = await insertAwaitingRun(inst, workflow.id);

    const note = "Not enough context to approve yet.";
    const rejected = await callAs(inst, "principal", decideWorkflowRun, { runId: run.id, decision: "reject", note });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) return;
    // Resumed in the request down the rejected edge; the handler clears pending_decision once applied.
    expect(rejected.data).toMatchObject({ runId: run.id, status: "done" });
    expect(rejected.data.steps.map((s) => [s.node_id, s.note])).toEqual([
      ["n2", "Rejected"],
      ["e2", "End"],
    ]);

    const [row] = await sql`select pending_decision, decision_note, decided_at from public.workflow_runs where id = ${run.id}::uuid`;
    expect(row.pending_decision).toBeNull();
    expect(row.decided_at).not.toBeNull();
    expect(row.decision_note).toBe(note);

    // 0096's decide_workflow_run writes the decision payload to the audit
    // row's `after` column (not `metadata`) — see app.audit's call shape.
    const [auditRow] = await sql`
      select after from public.audit_events
      where institution_id = ${inst.institutionId} and action = 'workflow.run.rejected' and entity_id = ${run.id}::uuid
    `;
    expect(auditRow.after).toEqual({ run_id: run.id, node_id: "n2" });
    expect(JSON.stringify(auditRow.after)).not.toContain(note);
  });

  it("decideWorkflowRun: another institution's run id is not_found", async () => {
    await withTwoInstitutions(async (a, b) => {
      const workflowInB = await insertWorkflow(b);
      const runInB = await insertAwaitingRun(b, workflowInB.id);
      const crossInstitution = await callAs(a, "principal", decideWorkflowRun, { runId: runInB.id, decision: "approve" });
      expect(crossInstitution.ok).toBe(false);
      if (crossInstitution.ok) return;
      expect(crossInstitution.error.code).toBe("not_found");
    });
  });
});
