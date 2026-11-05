// M23-T3 — migration 0096 part 2: run lifecycle definers (M23-tasks.md
// rulings: Run lifecycle). "Due"/"stuck" state is forced via the raw `sql`
// connection (session_user = 'postgres', trusted by app.guard_workflow_write
// — same technique as tests/db/report-sweep-rpc.test.ts) or via direct
// service-role INSERT (the BEFORE UPDATE guards never fire on insert),
// never through an authenticated client.
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

const NODES = [{ id: "t" }, { id: "e" }];
const EDGES = [{ source: "t", target: "e" }];

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

function workflowRow(institutionId: string, createdBy: string, overrides: Record<string, unknown> = {}) {
  return {
    institution_id: institutionId,
    name: `Workflow ${crypto.randomUUID().slice(0, 8)}`,
    created_by: createdBy,
    nodes: NODES,
    edges: EDGES,
    status: "active",
    trigger_type: "manual",
    trigger_config: "",
    ...overrides,
  };
}

async function insertWorkflow(
  inst: TestInstitution,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number; next_run_at: string | null }> {
  const { data, error } = await admin
    .from("workflows")
    .insert(workflowRow(inst.institutionId, inst.users.principal.id, overrides))
    .select("id, version, next_run_at")
    .single();
  if (error || !data) throw error ?? new Error("workflow insert failed");
  return data as { id: string; version: number; next_run_at: string | null };
}

async function insertRun(
  inst: TestInstitution,
  workflowId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const { data, error } = await admin
    .from("workflow_runs")
    .insert({
      institution_id: inst.institutionId,
      workflow_id: workflowId,
      workflow_version: 1,
      graph: { nodes: NODES, edges: EDGES },
      trigger_kind: "manual",
      trigger_key: `manual:${crypto.randomUUID()}`,
      status: "running",
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("run insert failed");
  return data as { id: string };
}

async function setNextRunAt(id: string, when: Date): Promise<void> {
  await sql`update public.workflows set next_run_at = ${when.toISOString()} where id = ${id}::uuid`;
}

async function runsFor(workflowId: string) {
  return sql`select * from public.workflow_runs where workflow_id = ${workflowId}::uuid order by created_at`;
}

async function jobForRun(runId: string) {
  return sql`select * from public.jobs where type = 'workflow.run' and payload ->> 'run_id' = ${runId}`;
}

async function auditFor(entityId: string, action: string) {
  return sql`select * from public.audit_events where entity_id = ${entityId}::uuid and action = ${action}`;
}

describe("public.emit_workflow_event (0096 part 2)", () => {
  it("one active event workflow -> 1 run (running, graph + version snapshot) + one workflow.run job; replay is idempotent", async () => {
    const inst = await createTestInstitution("emit-basic");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst, { trigger_type: "event", trigger_config: "enquiry.received" });
    const entityId = crypto.randomUUID();

    const first = await admin.rpc("emit_workflow_event", {
      p_institution_id: inst.institutionId,
      p_event: "enquiry.received",
      p_entity_id: entityId,
    });
    expect(first.error).toBeNull();
    expect(first.data).toBe(1);

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("running");
    expect(runs[0].workflow_version).toBe(workflow.version);
    expect(runs[0].graph).toEqual({ nodes: NODES, edges: EDGES });
    expect(runs[0].entity_id).toBe(entityId);

    const jobs = await jobForRun(runs[0].id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe(`workflow.run:${runs[0].id}:start`);
    expect(jobs[0].payload).toEqual({ run_id: runs[0].id });

    const replay = await admin.rpc("emit_workflow_event", {
      p_institution_id: inst.institutionId,
      p_event: "enquiry.received",
      p_entity_id: entityId,
    });
    expect(replay.data).toBe(0);
    expect(await runsFor(workflow.id)).toHaveLength(1);
  });

  it("a paused matching workflow is never swept", async () => {
    const inst = await createTestInstitution("emit-paused");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst, {
      trigger_type: "event",
      trigger_config: "results.published",
      status: "paused",
    });

    const { data } = await admin.rpc("emit_workflow_event", {
      p_institution_id: inst.institutionId,
      p_event: "results.published",
      p_entity_id: crypto.randomUUID(),
    });
    expect(data).toBe(0);
    expect(await runsFor(workflow.id)).toHaveLength(0);
  });

  it("workflows module off -> 0, no run", async () => {
    const inst = await createTestInstitution("emit-module-off");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst, { trigger_type: "event", trigger_config: "enquiry.received" });
    await setModule(inst.institutionId, "workflows", false);

    const { data } = await admin.rpc("emit_workflow_event", {
      p_institution_id: inst.institutionId,
      p_event: "enquiry.received",
      p_entity_id: crypto.randomUUID(),
    });
    expect(data).toBe(0);
    expect(await runsFor(workflow.id)).toHaveLength(0);
  });

  it("unknown event is validation_failed", async () => {
    const inst = await createTestInstitution("emit-unknown-event");
    createdInstitutions.push(inst);

    const { error } = await admin.rpc("emit_workflow_event", {
      p_institution_id: inst.institutionId,
      p_event: "not.a.real.event",
      p_entity_id: crypto.randomUUID(),
    });
    expect(error?.message).toContain("code:validation_failed");
  });

  it("an authenticated principal calling emit is permission denied", async () => {
    const inst = await createTestInstitution("emit-perm");
    createdInstitutions.push(inst);

    const { error } = await inst.clientAs("principal").rpc("emit_workflow_event", {
      p_institution_id: inst.institutionId,
      p_event: "enquiry.received",
      p_entity_id: crypto.randomUUID(),
    });
    expect(error?.code).toBe("42501");
  });
});

describe("public.enqueue_due_workflows (0096 part 2)", () => {
  async function insertSchedule(inst: TestInstitution) {
    return insertWorkflow(inst, { trigger_type: "schedule", trigger_config: "0 20 * * *" });
  }

  it("one due active schedule enqueues exactly one run + job and advances next_run_at; second call enqueues nothing more", async () => {
    const inst = await createTestInstitution("sweep-due");
    createdInstitutions.push(inst);

    const workflow = await insertSchedule(inst);
    const pastFire = new Date(Date.now() - 60_000);
    await setNextRunAt(workflow.id, pastFire);

    const first = await admin.rpc("enqueue_due_workflows");
    expect(first.error).toBeNull();
    expect(first.data).toBe(1);

    const runs = await runsFor(workflow.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].trigger_kind).toBe("schedule");
    const jobs = await jobForRun(runs[0].id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe(`workflow.run:${runs[0].id}:start`);

    const [row] = await sql`select next_run_at from public.workflows where id = ${workflow.id}::uuid`;
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());

    const second = await admin.rpc("enqueue_due_workflows");
    expect(second.data).toBe(0);
    expect(await runsFor(workflow.id)).toHaveLength(1);
  });

  it("overdue by 3 days fires once, advancing next_run_at past now", async () => {
    const inst = await createTestInstitution("sweep-overdue");
    createdInstitutions.push(inst);

    const workflow = await insertSchedule(inst);
    await setNextRunAt(workflow.id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));

    const { data } = await admin.rpc("enqueue_due_workflows");
    expect(data).toBe(1);
    expect(await runsFor(workflow.id)).toHaveLength(1);

    const [row] = await sql`select next_run_at from public.workflows where id = ${workflow.id}::uuid`;
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("module off skips the row and leaves next_run_at untouched", async () => {
    const inst = await createTestInstitution("sweep-module-off");
    createdInstitutions.push(inst);

    const workflow = await insertSchedule(inst);
    const pastFire = new Date(Date.now() - 60_000);
    await setNextRunAt(workflow.id, pastFire);
    await setModule(inst.institutionId, "workflows", false);

    const { data } = await admin.rpc("enqueue_due_workflows");
    expect(data).toBe(0);
    expect(await runsFor(workflow.id)).toHaveLength(0);
    const [row] = await sql`select next_run_at from public.workflows where id = ${workflow.id}::uuid`;
    expect(new Date(row.next_run_at).toISOString()).toBe(pastFire.toISOString());
  });

  it("reaper fails a run stuck running for 7h; leaves a 1h-old running run untouched", async () => {
    const inst = await createTestInstitution("sweep-reaper");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const stuck = await insertRun(inst, workflow.id, { updated_at: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
    const fresh = await insertRun(inst, workflow.id, { updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

    await admin.rpc("enqueue_due_workflows");

    const [stuckRow] = await sql`select * from public.workflow_runs where id = ${stuck.id}::uuid`;
    expect(stuckRow.status).toBe("failed");
    expect(stuckRow.finished_at).not.toBeNull();
    expect(stuckRow.cursor_node_id).toBeNull();
    expect(stuckRow.pending_decision).toBeNull();
    expect(stuckRow.steps).toHaveLength(1);
    expect(stuckRow.steps[0]).toMatchObject({ node_id: "_run", status: "failed", note: "Stopped: no progress for 6 hours" });

    const [freshRow] = await sql`select * from public.workflow_runs where id = ${fresh.id}::uuid`;
    expect(freshRow.status).toBe("running");
  });
});

describe("public.start_workflow_run (0096 part 2)", () => {
  it("principal starts a manual run: returns the run id, requested_by set, audit row written", async () => {
    const inst = await createTestInstitution("start-basic");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const { data: runId, error } = await inst.clientAs("principal").rpc("start_workflow_run", { p_workflow_id: workflow.id });
    expect(error).toBeNull();

    const [run] = await sql`select * from public.workflow_runs where id = ${runId}::uuid`;
    expect(run.requested_by).toBe(inst.users.principal.id);
    expect(run.trigger_kind).toBe("manual");

    const audit = await auditFor(runId as string, "workflow.run.started");
    expect(audit).toHaveLength(1);
  });

  it("calling again in the same minute returns the same run id", async () => {
    const inst = await createTestInstitution("start-idempotent");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const a = await inst.clientAs("principal").rpc("start_workflow_run", { p_workflow_id: workflow.id });
    const b = await inst.clientAs("principal").rpc("start_workflow_run", { p_workflow_id: workflow.id });
    expect(a.data).toBe(b.data);
    expect(await runsFor(workflow.id)).toHaveLength(1);
  });

  it("admin cannot start a run (forbidden)", async () => {
    const inst = await createTestInstitution("start-admin");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const { error } = await inst.clientAs("admin").rpc("start_workflow_run", { p_workflow_id: workflow.id });
    expect(error?.message).toContain("code:forbidden");
  });

  it("another institution's principal gets not_found", async () => {
    const instA = await createTestInstitution("start-cross-a");
    const instB = await createTestInstitution("start-cross-b");
    createdInstitutions.push(instA, instB);

    const workflow = await insertWorkflow(instA);
    const { error } = await instB.clientAs("principal").rpc("start_workflow_run", { p_workflow_id: workflow.id });
    expect(error?.message).toContain("code:not_found");
  });

  it("an event-triggered workflow cannot be started manually (invalid_state)", async () => {
    const inst = await createTestInstitution("start-event");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst, { trigger_type: "event", trigger_config: "enquiry.received" });
    const { error } = await inst.clientAs("principal").rpc("start_workflow_run", { p_workflow_id: workflow.id });
    expect(error?.message).toContain("code:invalid_state");
  });

  it("a paused workflow cannot be started (invalid_state)", async () => {
    const inst = await createTestInstitution("start-paused");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst, { status: "paused" });
    const { error } = await inst.clientAs("principal").rpc("start_workflow_run", { p_workflow_id: workflow.id });
    expect(error?.message).toContain("code:invalid_state");
  });
});

describe("public.decide_workflow_run (0096 part 2)", () => {
  async function insertAwaitingRun(inst: TestInstitution, workflowId: string) {
    return insertRun(inst, workflowId, { status: "awaiting_approval", cursor_node_id: "n2" });
  }

  it("principal approves: running, pending_decision approved, job queued for the cursor node", async () => {
    const inst = await createTestInstitution("decide-approve");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const run = await insertAwaitingRun(inst, workflow.id);

    const { data, error } = await inst.clientAs("principal").rpc("decide_workflow_run", { p_run_id: run.id, p_decision: "approve" });
    expect(error).toBeNull();
    expect(data.status).toBe("running");
    expect(data.pending_decision).toBe("approved");
    expect(data.decided_by).toBe(inst.users.principal.id);

    const jobs = await jobForRun(run.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].idempotency_key).toBe(`workflow.run:${run.id}:n2`);

    const audit = await auditFor(run.id, "workflow.run.approved");
    expect(audit).toHaveLength(1);
  });

  it("deciding the same run twice is invalid_state", async () => {
    const inst = await createTestInstitution("decide-twice");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const run = await insertAwaitingRun(inst, workflow.id);

    const first = await inst.clientAs("principal").rpc("decide_workflow_run", { p_run_id: run.id, p_decision: "approve" });
    expect(first.error).toBeNull();

    const second = await inst.clientAs("principal").rpc("decide_workflow_run", { p_run_id: run.id, p_decision: "approve" });
    expect(second.error?.message).toContain("code:invalid_state");
  });

  it("admin cannot decide (forbidden)", async () => {
    const inst = await createTestInstitution("decide-admin");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const run = await insertAwaitingRun(inst, workflow.id);

    const { error } = await inst.clientAs("admin").rpc("decide_workflow_run", { p_run_id: run.id, p_decision: "approve" });
    expect(error?.message).toContain("code:forbidden");
  });

  it("a 501-character note is validation_failed", async () => {
    const inst = await createTestInstitution("decide-note-too-long");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const run = await insertAwaitingRun(inst, workflow.id);

    const { error } = await inst
      .clientAs("principal")
      .rpc("decide_workflow_run", { p_run_id: run.id, p_decision: "approve", p_note: "x".repeat(501) });
    expect(error?.message).toContain("code:validation_failed");
  });

  it("reject sets pending_decision rejected", async () => {
    const inst = await createTestInstitution("decide-reject");
    createdInstitutions.push(inst);

    const workflow = await insertWorkflow(inst);
    const run = await insertAwaitingRun(inst, workflow.id);

    const { data, error } = await inst.clientAs("principal").rpc("decide_workflow_run", { p_run_id: run.id, p_decision: "reject" });
    expect(error).toBeNull();
    expect(data.pending_decision).toBe("rejected");
  });
});
