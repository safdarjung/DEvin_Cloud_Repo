import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { queueWorkflowAgentRun } from "../../src/modules/agents/queue.ts";

// Direct service-role client (supabase-js): exercises real table/column
// grants, same shape as tests/db/agents-rls.test.ts and workflows-rls.test.ts.
function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

afterAll(async () => {
  await closeRolesHelper();
});

const MANUAL_NODES = [{ id: "t" }, { id: "e" }];
const MANUAL_EDGES = [{ source: "t", target: "e" }];

async function insertWorkflow(institutionId: string, createdBy: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("workflows")
    .insert({
      institution_id: institutionId,
      name: `Workflow ${crypto.randomUUID().slice(0, 8)}`,
      trigger_type: "manual",
      trigger_config: "",
      nodes: MANUAL_NODES,
      edges: MANUAL_EDGES,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function insertRun(institutionId: string, workflowId: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("workflow_runs")
    .insert({
      institution_id: institutionId,
      workflow_id: workflowId,
      workflow_version: 1,
      graph: { nodes: MANUAL_NODES, edges: MANUAL_EDGES },
      trigger_kind: "manual",
      trigger_key: `manual:${crypto.randomUUID()}`,
      status: "running",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function definitionRows(institutionId: string): Promise<{ slug: string; is_enabled: boolean }[]> {
  const { data, error } = await serviceClient()
    .from("agent_definitions")
    .select("slug, is_enabled")
    .eq("institution_id", institutionId);
  if (error) throw error;
  return data as { slug: string; is_enabled: boolean }[];
}

describe("queueWorkflowAgentRun (M23-T10)", () => {
  it("queues a run, materialises all 6 definitions, is idempotent, and respects disabled/unknown slugs", async () => {
    const inst = await createTestInstitution("agents-queue");
    try {
      const admin = serviceClient();
      const workflowId = await insertWorkflow(inst.institutionId, inst.users.principal.id);
      const runId = await insertRun(inst.institutionId, workflowId);

      // No agent_definitions rows exist yet for this institution.
      expect(await definitionRows(inst.institutionId)).toHaveLength(0);

      const first = await queueWorkflowAgentRun(admin as never, {
        institutionId: inst.institutionId,
        slug: "finance",
        task: "Review overdue invoices",
        requestedBy: inst.users.principal.id,
        workflowRunId: runId,
      });
      expect(first).toMatchObject({ status: "queued", created: true });
      if (first.status !== "queued") throw new Error("expected queued");

      const defs = await definitionRows(inst.institutionId);
      expect(defs).toHaveLength(6);
      expect(defs.map((d) => d.slug).sort()).toEqual(
        ["academic", "admissions", "administrative", "attendance", "communication", "finance"].sort(),
      );

      const { data: row, error } = await admin
        .from("agent_runs")
        .select("status, workflow_run_id, requested_by, risk_class, catalog_version")
        .eq("id", first.runId)
        .single();
      if (error) throw error;
      expect(row).toMatchObject({
        status: "queued",
        workflow_run_id: runId,
        requested_by: inst.users.principal.id,
        risk_class: "read_only",
        catalog_version: "agents_v1",
      });

      // Second call for the same (workflow_run_id, agent) is idempotent.
      const second = await queueWorkflowAgentRun(admin as never, {
        institutionId: inst.institutionId,
        slug: "finance",
        task: "Review overdue invoices again",
        requestedBy: inst.users.principal.id,
        workflowRunId: runId,
      });
      expect(second).toEqual({ status: "queued", runId: first.runId, created: false });

      const { count } = await admin
        .from("agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("workflow_run_id", runId)
        .eq("agent_id", (await admin.from("agent_definitions").select("id").eq("institution_id", inst.institutionId).eq("slug", "finance").single()).data!.id);
      expect(count).toBe(1);

      // A disabled definition queues nothing.
      await admin
        .from("agent_definitions")
        .update({ is_enabled: false })
        .eq("institution_id", inst.institutionId)
        .eq("slug", "admissions");
      const runId2 = await insertRun(inst.institutionId, workflowId);
      const disabled = await queueWorkflowAgentRun(admin as never, {
        institutionId: inst.institutionId,
        slug: "admissions",
        task: "Follow up stale enquiries",
        requestedBy: inst.users.principal.id,
        workflowRunId: runId2,
      });
      expect(disabled).toEqual({ status: "disabled" });
      const { count: disabledCount } = await admin
        .from("agent_runs")
        .select("id", { count: "exact", head: true })
        .eq("workflow_run_id", runId2);
      expect(disabledCount).toBe(0);

      // Unknown slug throws before touching the DB.
      await expect(
        queueWorkflowAgentRun(admin as never, {
          institutionId: inst.institutionId,
          slug: "not-a-real-agent",
          task: "x",
          requestedBy: inst.users.principal.id,
          workflowRunId: runId,
        }),
      ).rejects.toThrow("invalid_agent");
    } finally {
      await inst.cleanup();
    }
  });
});
