// M23-T12 — job handler `workflow.run` against the real DB (service-role
// client, real rpcs), same shape as tests/db/report-generate-job.test.ts
// (handler called directly with a hand-built job row, no runner).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { workflowRun } from "@/modules/jobs/handlers/index";
import type { Json } from "@/lib/db/types";
import { closeFactoriesHelper, createEnquiry } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

async function freshInstitution(name: string): Promise<TestInstitution> {
  const inst = await createTestInstitution(name);
  createdInstitutions.push(inst);
  return inst;
}

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

// Condition-true graph: manual trigger -> condition (admissions.stale_enquiries
// gte 1) -true-> notify roles -> end. Minimal node count that still exercises
// every node type the "condition true" case needs (trigger/condition/notify/end).
const CONDITION_NODES = [
  { id: "t", type: "trigger", label: "Trigger", config: { kind: "manual" } },
  { id: "c", type: "condition", label: "Condition", config: { metric: "admissions.stale_enquiries", op: "gte", value: "1" } },
  { id: "n", type: "notify", label: "Notify", config: { audience: "roles", roles: "principal", message: "{count} stale enquiries" } },
  { id: "e", type: "end", label: "End", config: {} },
];
const CONDITION_EDGES = [
  { source: "t", target: "c" },
  { source: "c", target: "n", label: "true" },
  { source: "n", target: "e" },
];

// Approval graph: manual trigger -> approval -approved-> end (no `rejected`
// edge, so a reject resumes straight to `done` per the engine ruling).
const APPROVAL_NODES = [
  { id: "t", type: "trigger", label: "Trigger", config: { kind: "manual" } },
  { id: "a", type: "approval", label: "Approval", config: { prompt: "Approve?" } },
  { id: "e", type: "end", label: "End", config: {} },
];
const APPROVAL_EDGES = [
  { source: "t", target: "a" },
  { source: "a", target: "e", label: "approved" },
];

function workflowRow(
  inst: TestInstitution,
  nodes: NonNullable<Json>,
  edges: NonNullable<Json>,
  triggerType = "manual",
  triggerConfig = "",
) {
  return {
    institution_id: inst.institutionId,
    name: `Workflow ${crypto.randomUUID().slice(0, 8)}`,
    created_by: inst.users.principal.id,
    nodes,
    edges,
    status: "active",
    trigger_type: triggerType,
    trigger_config: triggerConfig,
  };
}

async function insertWorkflow(inst: TestInstitution, nodes: unknown, edges: unknown): Promise<string> {
  const { data, error } = await admin
    .from("workflows")
    .insert(workflowRow(inst, nodes as NonNullable<Json>, edges as NonNullable<Json>))
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("workflow insert failed");
  return data.id as string;
}

async function insertRun(inst: TestInstitution, workflowId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin
    .from("workflow_runs")
    .insert({
      institution_id: inst.institutionId,
      workflow_id: workflowId,
      workflow_version: 1,
      graph: { nodes: CONDITION_NODES, edges: CONDITION_EDGES },
      trigger_kind: "manual",
      trigger_key: `manual:${crypto.randomUUID()}`,
      status: "running",
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("run insert failed");
  return data.id as string;
}

async function startManualRun(inst: TestInstitution, workflowId: string): Promise<string> {
  const { data, error } = await inst.clientAs("principal").rpc("start_workflow_run", { p_workflow_id: workflowId });
  if (error || !data) throw error ?? new Error("start_workflow_run returned no id");
  return data as string;
}

async function readRun(runId: string) {
  const { data, error } = await admin.from("workflow_runs").select("*").eq("id", runId).single();
  if (error || !data) throw error ?? new Error("run not found");
  return data;
}

function makeJob(institutionId: string, runId: string, idempotencyKey = `test:${crypto.randomUUID()}`) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    institution_id: institutionId,
    type: "workflow.run" as const,
    payload: { run_id: runId },
    idempotency_key: idempotencyKey,
    status: "running" as const,
    attempts: 1,
    max_attempts: 5,
    run_after: now,
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: now,
    updated_at: now,
  };
}

async function workflowAlertCount(institutionId: string, recipientUserId: string): Promise<number> {
  const { count, error } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", institutionId)
    .eq("type", "workflow_alert")
    .eq("recipient_user_id", recipientUserId);
  if (error) throw error;
  return count ?? 0;
}

describe("workflowRun handler (M23-T12)", () => {
  it("condition true -> run done, 4 steps (trigger/condition/notify/end), engine_version set, principal notified", async () => {
    const inst = await freshInstitution("wfjob-cond-true");
    await createEnquiry(inst.institutionId, { status: "new" });
    await sql`update public.enquiries set created_at = now() - interval '3 days' where institution_id = ${inst.institutionId}`;

    const workflowId = await insertWorkflow(inst, CONDITION_NODES, CONDITION_EDGES);
    const runId = await startManualRun(inst, workflowId);

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("done");
    expect(run.finished_at).not.toBeNull();
    expect(run.engine_version).toBe("workflows_v1");
    const steps = run.steps as { node_id: string; status: string }[];
    expect(steps.map((s) => s.node_id)).toEqual(["t", "c", "n", "e"]);
    expect(steps.every((s) => s.status === "done")).toBe(true);
    expect(await workflowAlertCount(inst.institutionId, inst.users.principal.id)).toBe(1);
  });

  it("approval graph -> awaiting_approval, cursor_node_id set, finished_at null", async () => {
    const inst = await freshInstitution("wfjob-approval");
    const workflowId = await insertWorkflow(inst, APPROVAL_NODES, APPROVAL_EDGES);
    const runId = await startManualRun(inst, workflowId);

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("awaiting_approval");
    expect(run.cursor_node_id).toBe("a");
    expect(run.finished_at).toBeNull();
  });

  it("decide_workflow_run approve then the resume job -> done, steps appended (not replaced)", async () => {
    const inst = await freshInstitution("wfjob-approve-resume");
    const workflowId = await insertWorkflow(inst, APPROVAL_NODES, APPROVAL_EDGES);
    const runId = await startManualRun(inst, workflowId);
    await workflowRun(makeJob(inst.institutionId, runId), { admin });
    const afterFirst = await readRun(runId);
    expect(afterFirst.status).toBe("awaiting_approval");

    const { error: decideError } = await inst
      .clientAs("principal")
      .rpc("decide_workflow_run", { p_run_id: runId, p_decision: "approve" });
    expect(decideError).toBeNull();

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("done");
    expect(run.finished_at).not.toBeNull();
    const steps = run.steps as { node_id: string; status: string; note?: string }[];
    expect(steps.map((s) => `${s.node_id}:${s.status}`)).toEqual(["t:done", "a:running", "a:done", "e:done"]);
    expect(steps[2].note).toBe("Approved");
  });

  it("decide_workflow_run reject without a `rejected` edge -> done", async () => {
    const inst = await freshInstitution("wfjob-reject");
    const workflowId = await insertWorkflow(inst, APPROVAL_NODES, APPROVAL_EDGES);
    const runId = await startManualRun(inst, workflowId);
    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const { error: decideError } = await inst
      .clientAs("principal")
      .rpc("decide_workflow_run", { p_run_id: runId, p_decision: "reject" });
    expect(decideError).toBeNull();

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("done");
    const steps = run.steps as { node_id: string; status: string; note?: string }[];
    expect(steps.at(-1)).toEqual(expect.objectContaining({ node_id: "a", status: "done", note: "Rejected" }));
  });

  it("workflows module off -> no-op, run stays running", async () => {
    const inst = await freshInstitution("wfjob-module-off");
    const workflowId = await insertWorkflow(inst, CONDITION_NODES, CONDITION_EDGES);
    const runId = await startManualRun(inst, workflowId);
    await setModule(inst.institutionId, "workflows", false);

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("running");
    expect(run.steps).toEqual([]);
  });

  it("run already done -> no-op", async () => {
    const inst = await freshInstitution("wfjob-already-done");
    const workflowId = await insertWorkflow(inst, CONDITION_NODES, CONDITION_EDGES);
    const runId = await insertRun(inst, workflowId, { status: "done", finished_at: new Date().toISOString() });

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("done");
    expect(run.steps).toEqual([]);
  });

  it("a cyclic snapshot (service-role insert) -> failed with a `_run` step", async () => {
    const inst = await freshInstitution("wfjob-cycle");
    const workflowId = await insertWorkflow(inst, CONDITION_NODES, CONDITION_EDGES);
    const cyclicNodes = [
      { id: "t", type: "trigger", label: "Trigger", config: { kind: "manual" } },
      { id: "c", type: "condition", label: "Condition", config: { metric: "admissions.stale_enquiries", op: "gte", value: "1" } },
    ];
    const cyclicEdges = [
      { source: "t", target: "c" },
      { source: "c", target: "t", label: "true" },
    ];
    const runId = await insertRun(inst, workflowId, { graph: { nodes: cyclicNodes, edges: cyclicEdges } });

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("failed");
    expect(run.finished_at).not.toBeNull();
    const steps = run.steps as { node_id: string; status: string; note?: string }[];
    expect(steps).toEqual([{ node_id: "_run", status: "failed", at: expect.any(String), note: "Invalid workflow graph" }]);
  });

  it("a metric rpc failure (subject metric, null entity on a hand-built run) -> failed", async () => {
    const inst = await freshInstitution("wfjob-metric-fail");
    const eventNodes = [
      { id: "t", type: "trigger", label: "Trigger", config: { kind: "event", event: "attendance.absences_submitted" } },
      { id: "c", type: "condition", label: "Condition", config: { metric: "attendance.session_absences", op: "gte", value: "1" } },
      { id: "n", type: "notify", label: "Notify", config: { audience: "roles", roles: "principal", message: "{count}" } },
      { id: "e", type: "end", label: "End", config: {} },
    ];
    const eventEdges = [
      { source: "t", target: "c" },
      { source: "c", target: "n", label: "true" },
      { source: "n", target: "e" },
    ];
    const workflowId = await insertWorkflow(
      inst,
      [
        { id: "t", type: "trigger", label: "Trigger", config: { kind: "manual" } },
        { id: "e", type: "end", label: "End", config: {} },
      ],
      [{ source: "t", target: "e" }],
    );
    // Hand-built run: the graph is internally consistent (passes parseGraph),
    // but `entity_id` is null, which `workflow_metric` rejects for a subject
    // metric — a real `event`-triggered run always carries a non-null entity
    // (`emit_workflow_event`), so this shape only arises from a direct insert.
    const runId = await insertRun(inst, workflowId, {
      graph: { nodes: eventNodes, edges: eventEdges },
      trigger_kind: "event",
      entity_id: null,
    });

    await workflowRun(makeJob(inst.institutionId, runId), { admin });

    const run = await readRun(runId);
    expect(run.status).toBe("failed");
    const steps = run.steps as { node_id: string; status: string; note?: string }[];
    expect(steps.at(-1)).toEqual(expect.objectContaining({ node_id: "c", status: "failed", note: "Failed: metric_failed" }));
  });

  it("handler run twice on the same job -> one notification per recipient (idempotent on the run's own status guard)", async () => {
    const inst = await freshInstitution("wfjob-twice");
    await createEnquiry(inst.institutionId, { status: "new" });
    await sql`update public.enquiries set created_at = now() - interval '3 days' where institution_id = ${inst.institutionId}`;
    const workflowId = await insertWorkflow(inst, CONDITION_NODES, CONDITION_EDGES);
    const runId = await startManualRun(inst, workflowId);
    const job = makeJob(inst.institutionId, runId);

    await workflowRun(job, { admin });
    await workflowRun(job, { admin }); // same claimed row, called again (crash/retry simulation)

    const run = await readRun(runId);
    expect(run.status).toBe("done");
    expect((run.steps as unknown[]).length).toBe(4);
    expect(await workflowAlertCount(inst.institutionId, inst.users.principal.id)).toBe(1);
  });
});
