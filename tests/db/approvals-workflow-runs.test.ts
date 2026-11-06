import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";

// M23-T18 — adds the `workflow_run` source to the approvals union
// (06-backend-packets/M23-tasks.md Task 18), and the "workflow task waiting
// to start" extension of the `agent_run` source. Fixture institution
// (not the seeded demo tenant): both tables are server-write-only, mirrors
// tests/db/approvals-agent-runs.test.ts and tests/db/workflows-rls.test.ts.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { agentDefinitionsQuery } from "@/modules/agents/query-defs";
import { pendingApprovals } from "@/modules/core/approvals.queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { withModules } from "../helpers/demo-context";

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

afterAll(async () => {
  await closeActionsHelper();
  await closeRolesHelper();
});

const MANUAL_NODES = [
  { id: "t", type: "trigger", label: "Start", config: {} },
  { id: "a", type: "approval", label: "Approve", config: { prompt: "Send fee reminders to families with overdue invoices?" } },
  { id: "e", type: "end", label: "End", config: {} },
];
const MANUAL_EDGES = [
  { source: "t", target: "a" },
  { source: "a", target: "e", label: "approved" },
];

async function insertWorkflowAsService(institutionId: string, createdBy: string, name: string): Promise<string> {
  const { data, error } = await serviceClient()
    .from("workflows")
    .insert({
      institution_id: institutionId,
      name,
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
      trigger_key: `manual:${crypto.randomUUID()}`,
      status: overrides.status ?? "running",
      cursor_node_id: "a",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function insertQueuedAgentRun(
  institutionId: string,
  agentId: string,
  requestedBy: string,
  workflowRunId: string,
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_runs")
    .insert({
      institution_id: institutionId,
      agent_id: agentId,
      requested_by: requestedBy,
      task: "workflow-queued task",
      status: "queued",
      risk_class: "read_only",
      catalog_version: "agents_v1",
      workflow_run_id: workflowRunId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

describe("core.approvals.pending — workflow_run source + queued agent task (M23-T18)", () => {
  it("principal sees the awaiting run oldest first; admin sees none (no workflow.manage); done runs never appear", async () => {
    const inst = await createTestInstitution("approvals-workflow-runs");
    try {
      const workflowId = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id, "Fee reminder");
      const older = await insertRunAsService(inst.institutionId, workflowId, { status: "awaiting_approval" });
      const newer = await insertRunAsService(inst.institutionId, workflowId, { status: "awaiting_approval" });
      await insertRunAsService(inst.institutionId, workflowId, { status: "done", finished_at: new Date().toISOString() });

      const principalCtx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));
      const principalRows = await pendingApprovals(principalCtx);
      setActingClient(null);

      const workflowRows = principalRows.filter((r) => r.kind === "workflow_run");
      expect(workflowRows.map((r) => r.id)).toEqual([older, newer]);
      expect(workflowRows[0].title).toBe("Fee reminder: Send fee reminders to families with overdue invoices?");
      expect(workflowRows[0].requestedBy).toBe("Automation");

      const adminCtx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const adminRows = await pendingApprovals(adminCtx);
      setActingClient(null);
      expect(adminRows.some((r) => r.kind === "workflow_run")).toBe(false);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("workflows module off drops the source", async () => {
    const inst = await createTestInstitution("approvals-workflow-runs-gate");
    try {
      const workflowId = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id, "Fee reminder");
      await insertRunAsService(inst.institutionId, workflowId, { status: "awaiting_approval" });

      const principalCtx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));
      const withModuleOff = await pendingApprovals(withModules(principalCtx, { workflows: false }));
      setActingClient(null);
      expect(withModuleOff.some((r) => r.kind === "workflow_run")).toBe(false);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);

  it("a queued agent run from a workflow is visible only to its requester", async () => {
    const inst = await createTestInstitution("approvals-workflow-agent-task");
    try {
      const defs = await callAs(inst, "owner", agentDefinitionsQuery, {});
      if (!defs.ok) throw new Error("unreachable");
      const admissionsId = defs.data.find((d) => d.slug === "admissions")!.id;

      const workflowId = await insertWorkflowAsService(inst.institutionId, inst.users.principal.id, "Admissions follow-up");
      const runId = await insertRunAsService(inst.institutionId, workflowId, { status: "running", cursor_node_id: null });
      const queuedRunId = await insertQueuedAgentRun(inst.institutionId, admissionsId, inst.users.principal.id, runId);

      const principalCtx = await buildContext(inst, "principal");
      setActingClient(inst.clientAs("principal"));
      const principalRows = await pendingApprovals(principalCtx);
      setActingClient(null);

      const task = principalRows.find((r) => r.id === queuedRunId);
      expect(task?.kind).toBe("agent_run");
      expect(task?.title).toBe("Admissions agent: workflow task waiting to start");

      const adminCtx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const adminRows = await pendingApprovals(adminCtx);
      setActingClient(null);
      expect(adminRows.some((r) => r.id === queuedRunId)).toBe(false);
    } finally {
      await inst.cleanup();
    }
  }, 20_000);
});
