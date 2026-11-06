import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// Direct service-role client (supabase-js): exercises the real table/column
// grants from the migration, not just RLS (mirrors tests/db/agents-rls.test.ts).
function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

// Node/edge shape is validated by app code (T7's parseGraph), not the DB —
// 0096 part 1 only checks jsonb array type/length/size.
const MANUAL_NODES = [{ id: "t" }, { id: "e" }];
const MANUAL_EDGES = [{ source: "t", target: "e" }];

function manualWorkflowRow(institutionId: string, overrides: Record<string, unknown> = {}) {
  return {
    institution_id: institutionId,
    name: overrides.name ?? `Workflow ${crypto.randomUUID().slice(0, 8)}`,
    trigger_type: "manual",
    trigger_config: "",
    nodes: MANUAL_NODES,
    edges: MANUAL_EDGES,
    ...overrides,
  };
}

async function insertWorkflowAsService(
  institutionId: string,
  createdBy: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
  const { data, error } = await serviceClient()
    .from("workflows")
    .insert({ ...manualWorkflowRow(institutionId, overrides), created_by: createdBy })
    .select("id, version")
    .single();
  if (error) throw error;
  return data as { id: string; version: number };
}

async function insertRunAsService(
  institutionId: string,
  workflowId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("workflow_runs")
    .insert({
      institution_id: institutionId,
      workflow_id: workflowId,
      workflow_version: 1,
      graph: { nodes: MANUAL_NODES, edges: MANUAL_EDGES },
      trigger_kind: "manual",
      trigger_key: overrides.trigger_key ?? `manual:${crypto.randomUUID()}`,
      status: overrides.status ?? "running",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function insertAgentDefinition(institutionId: string, slug = "finance"): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_definitions")
    .insert({ institution_id: institutionId, slug })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

describe("workflows table + write guard + RLS (0096 part 1)", () => {
  it("principal inserts a draft workflow: version 1, created_by forced to caller", async () => {
    const inst = await createTestInstitution("wf-insert-draft");
    try {
      const { data, error } = await inst
        .clientAs("principal")
        .from("workflows")
        .insert(manualWorkflowRow(inst.institutionId, { created_by: inst.users.teacher.id }))
        .select()
        .single();

      expect(error).toBeNull();
      expect(data.version).toBe(1);
      expect(data.status).toBe("draft");
      expect(data.created_by).toBe(inst.users.principal.id);
    } finally {
      await inst.cleanup();
    }
  });

  it("principal inserting a non-draft workflow is invalid_state", async () => {
    const inst = await createTestInstitution("wf-insert-active");
    try {
      const { error } = await inst
        .clientAs("principal")
        .from("workflows")
        .insert(manualWorkflowRow(inst.institutionId, { status: "active" }));

      expect(error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin cannot INSERT (42501); admin SELECT sees the institution's workflows; teacher/accountant/guardian see none", async () => {
    const inst = await createTestInstitution("wf-rls");
    try {
      await insertWorkflowAsService(inst.institutionId, inst.users.principal.id);

      const adminInsert = await inst.clientAs("admin").from("workflows").insert(manualWorkflowRow(inst.institutionId));
      expect(adminInsert.error?.code).toBe("42501");

      const adminSelect = await inst.clientAs("admin").from("workflows").select("id");
      expect(adminSelect.error).toBeNull();
      expect(adminSelect.data).toHaveLength(1);

      for (const role of ["teacher", "accountant", "guardian"] as const) {
        const { data, error } = await inst.clientAs(role).from("workflows").select("id");
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("graph update while active is invalid_state; while paused bumps version; name-only change while active leaves version unchanged", async () => {
    const inst = await createTestInstitution("wf-graph-edit");
    try {
      const created = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id);

      const activated = await inst.clientAs("principal").from("workflows").update({ status: "active" }).eq("id", created.id).select().single();
      expect(activated.error).toBeNull();
      expect(activated.data.version).toBe(1);

      const graphWhileActive = await inst
        .clientAs("principal")
        .from("workflows")
        .update({ nodes: [...MANUAL_NODES, { id: "extra" }] })
        .eq("id", created.id);
      expect(graphWhileActive.error?.message).toContain("code:invalid_state");

      const nameWhileActive = await inst
        .clientAs("principal")
        .from("workflows")
        .update({ name: "Renamed while active" })
        .eq("id", created.id)
        .select()
        .single();
      expect(nameWhileActive.error).toBeNull();
      expect(nameWhileActive.data.version).toBe(1);

      const paused = await inst.clientAs("principal").from("workflows").update({ status: "paused" }).eq("id", created.id).select().single();
      expect(paused.error).toBeNull();

      const graphWhilePaused = await inst
        .clientAs("principal")
        .from("workflows")
        .update({ nodes: [...MANUAL_NODES, { id: "extra" }] })
        .eq("id", created.id)
        .select()
        .single();
      expect(graphWhilePaused.error).toBeNull();
      expect(graphWhilePaused.data.version).toBe(2);
    } finally {
      await inst.cleanup();
    }
  });

  it("draft -> paused is an invalid status transition", async () => {
    const inst = await createTestInstitution("wf-bad-transition");
    try {
      const created = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id);
      const { error } = await inst.clientAs("principal").from("workflows").update({ status: "paused" }).eq("id", created.id);
      expect(error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("activating a schedule workflow with a cron that never fires is validation_failed; a firing cron sets next_run_at", async () => {
    const inst = await createTestInstitution("wf-schedule");
    try {
      const neverFires = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id, {
        trigger_type: "schedule",
        trigger_config: "0 8 31 2 *",
      });
      const activateNeverFires = await inst.clientAs("principal").from("workflows").update({ status: "active" }).eq("id", neverFires.id);
      expect(activateNeverFires.error?.message).toContain("code:validation_failed");

      const firing = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id, {
        trigger_type: "schedule",
        trigger_config: "0 20 * * *",
      });
      const activateFiring = await inst.clientAs("principal").from("workflows").update({ status: "active" }).eq("id", firing.id).select().single();
      expect(activateFiring.error).toBeNull();
      expect(activateFiring.data.next_run_at).not.toBeNull();

      const forcedUpdate = await inst
        .clientAs("principal")
        .from("workflows")
        .update({ next_run_at: new Date(Date.now() + 86_400_000).toISOString() })
        .eq("id", firing.id)
        .select()
        .single();
      expect(forcedUpdate.error).toBeNull();
      expect(forcedUpdate.data.next_run_at).toBe(activateFiring.data.next_run_at);
    } finally {
      await inst.cleanup();
    }
  });

  it("changing created_by or institution_id is forbidden", async () => {
    const instA = await createTestInstitution("wf-forbidden-a");
    const instB = await createTestInstitution("wf-forbidden-b");
    try {
      const created = await insertWorkflowAsService(instA.institutionId, instA.users.principal.id);

      const institutionChange = await instA.clientAs("principal").from("workflows").update({ institution_id: instB.institutionId }).eq("id", created.id);
      expect(institutionChange.error?.message).toContain("code:forbidden");

      const createdByChange = await instA.clientAs("principal").from("workflows").update({ created_by: instA.users.teacher.id }).eq("id", created.id);
      expect(createdByChange.error?.message).toContain("code:forbidden");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  });

  it("check constraints: unknown event, non-empty manual config, and 31 nodes are all 23514", async () => {
    const inst = await createTestInstitution("wf-checks");
    try {
      await expect(
        insertWorkflowAsService(inst.institutionId, inst.users.principal.id, { trigger_type: "event", trigger_config: "foo.bar" }),
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        insertWorkflowAsService(inst.institutionId, inst.users.principal.id, { trigger_type: "manual", trigger_config: "not-empty" }),
      ).rejects.toMatchObject({ code: "23514" });

      await expect(
        insertWorkflowAsService(inst.institutionId, inst.users.principal.id, {
          nodes: Array.from({ length: 31 }, (_, i) => ({ id: `n${i}` })),
        }),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await inst.cleanup();
    }
  });
});

describe("workflow_runs table + guard + RLS (0096 part 1)", () => {
  it("owner of B never sees A's runs; principal cannot INSERT or UPDATE (42501)", async () => {
    const instA = await createTestInstitution("wfr-rls-a");
    const instB = await createTestInstitution("wfr-rls-b");
    try {
      const workflowA = await insertWorkflowAsService(instA.institutionId, instA.users.principal.id);
      const workflowB = await insertWorkflowAsService(instB.institutionId, instB.users.principal.id);
      const runA = await insertRunAsService(instA.institutionId, workflowA.id);
      await insertRunAsService(instB.institutionId, workflowB.id);

      const ownerBRuns = await instB.clientAs("owner").from("workflow_runs").select("id");
      expect(ownerBRuns.error).toBeNull();
      expect((ownerBRuns.data ?? []).map((r) => r.id)).not.toContain(runA);

      const insertAttempt = await instA.clientAs("principal").from("workflow_runs").insert({
        institution_id: instA.institutionId,
        workflow_id: workflowA.id,
        workflow_version: 1,
        graph: {},
        trigger_kind: "manual",
        trigger_key: "manual:blocked",
      });
      expect(insertAttempt.error?.code).toBe("42501");

      const updateAttempt = await instA.clientAs("principal").from("workflow_runs").update({ status: "done" }).eq("id", runA);
      expect(updateAttempt.error?.code).toBe("42501");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 15000);

  it("guard: running->done with finished_at ok; done->running invalid_state; awaiting_approval->running without pending_decision invalid_state; graph is immutable", async () => {
    const inst = await createTestInstitution("wfr-guard");
    try {
      const workflow = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id);
      const runId = await insertRunAsService(inst.institutionId, workflow.id);

      const toDone = await serviceClient()
        .from("workflow_runs")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", runId);
      expect(toDone.error).toBeNull();

      const backToRunning = await serviceClient().from("workflow_runs").update({ status: "running" }).eq("id", runId);
      expect(backToRunning.error?.message).toContain("code:invalid_state");

      const awaitingId = await insertRunAsService(inst.institutionId, workflow.id, {
        status: "awaiting_approval",
        cursor_node_id: "a1",
        trigger_key: `manual:${crypto.randomUUID()}`,
      });
      const resumeWithoutDecision = await serviceClient().from("workflow_runs").update({ status: "running" }).eq("id", awaitingId);
      expect(resumeWithoutDecision.error?.message).toContain("code:invalid_state");

      const runningId = await insertRunAsService(inst.institutionId, workflow.id, { trigger_key: `manual:${crypto.randomUUID()}` });
      const graphChange = await serviceClient().from("workflow_runs").update({ graph: { changed: true } }).eq("id", runningId);
      expect(graphChange.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("cross-tenant workflow_id is 23503; duplicate (workflow_id, trigger_key) is 23505", async () => {
    const instA = await createTestInstitution("wfr-fk-a");
    const instB = await createTestInstitution("wfr-fk-b");
    try {
      const workflowB = await insertWorkflowAsService(instB.institutionId, instB.users.principal.id);
      await expect(insertRunAsService(instA.institutionId, workflowB.id)).rejects.toMatchObject({ code: "23503" });

      const workflowA = await insertWorkflowAsService(instA.institutionId, instA.users.principal.id);
      const key = `manual:${crypto.randomUUID()}`;
      await insertRunAsService(instA.institutionId, workflowA.id, { trigger_key: key });
      await expect(insertRunAsService(instA.institutionId, workflowA.id, { trigger_key: key })).rejects.toMatchObject({ code: "23505" });
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 15000);

  it("agent_runs.workflow_run_id is tenant-checked (23503) and idempotent per (workflow_run_id, agent_id) (23505)", async () => {
    const instA = await createTestInstitution("wfr-agent-fk-a");
    const instB = await createTestInstitution("wfr-agent-fk-b");
    try {
      const workflowB = await insertWorkflowAsService(instB.institutionId, instB.users.principal.id);
      const runB = await insertRunAsService(instB.institutionId, workflowB.id);
      const agentA = await insertAgentDefinition(instA.institutionId);

      const crossTenant = await serviceClient().from("agent_runs").insert({
        institution_id: instA.institutionId,
        agent_id: agentA,
        workflow_run_id: runB,
        requested_by: instA.users.principal.id,
        task: "Probe",
        catalog_version: "agents_v1",
      });
      expect(crossTenant.error?.code).toBe("23503");

      const workflowA = await insertWorkflowAsService(instA.institutionId, instA.users.principal.id);
      const runA = await insertRunAsService(instA.institutionId, workflowA.id);

      const first = await serviceClient().from("agent_runs").insert({
        institution_id: instA.institutionId,
        agent_id: agentA,
        workflow_run_id: runA,
        requested_by: instA.users.principal.id,
        task: "Probe",
        catalog_version: "agents_v1",
      });
      expect(first.error).toBeNull();

      const duplicate = await serviceClient().from("agent_runs").insert({
        institution_id: instA.institutionId,
        agent_id: agentA,
        workflow_run_id: runA,
        requested_by: instA.users.principal.id,
        task: "Probe again",
        catalog_version: "agents_v1",
      });
      expect(duplicate.error?.code).toBe("23505");
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 15000);
});
