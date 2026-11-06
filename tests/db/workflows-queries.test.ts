import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// M23-T17 — workflows.list / workflows.runs. Mirrors tests/db/agents-queries.test.ts's
// callAs-against-a-query style and tests/db/workflows-rls.test.ts's direct
// service-role insert helpers (queries are read-only; no action in this
// packet writes the rows these tests need).
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { workflowListQuery, workflowRunsQuery } from "@/modules/workflows/query-defs";
import { workflows as workflowsFixture, workflowRuns as workflowRunsFixture } from "@/modules/fabric/demo/agents";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const MANUAL_NODES = [{ id: "t" }, { id: "e" }];
const MANUAL_EDGES = [{ source: "t", target: "e" }];

async function insertWorkflowAsService(
  institutionId: string,
  createdBy: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; version: number }> {
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
      ...overrides,
    })
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
      trigger_key: `manual:${crypto.randomUUID()}`,
      status: "running",
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

const FIXTURE_OPTS = { now: new Date(), institutionId: crypto.randomUUID() };
const WORKFLOW_KEYS = Object.keys(workflowsFixture(FIXTURE_OPTS)[0]).sort();
const RUN_KEYS = Object.keys(workflowRunsFixture(FIXTURE_OPTS)[0]).sort();

describe("M23-T17 workflows.list", () => {
  it("keys equal the Workflow fixture keys; trigger is {type, config}; created_by is the principal's full name", async () => {
    const inst = await createTestInstitution("wf-q-list-keys");
    try {
      await sql`update public.profiles set full_name = 'Principal Priya' where id = ${inst.users.principal.id}`;
      await insertWorkflowAsService(inst.institutionId, inst.users.principal.id, {
        trigger_type: "schedule",
        trigger_config: "0 6 * * *",
        status: "active",
      });

      const result = await callAs(inst, "principal", workflowListQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toHaveLength(1);
      const row = result.data[0];
      expect(Object.keys(row).sort()).toEqual(WORKFLOW_KEYS);
      expect(row.trigger).toEqual({ type: "schedule", config: "0 6 * * *" });
      expect(row.created_by).toBe("Principal Priya");
    } finally {
      await inst.cleanup();
    }
  });

  it("filters by status", async () => {
    const inst = await createTestInstitution("wf-q-list-status");
    try {
      await insertWorkflowAsService(inst.institutionId, inst.users.owner.id, { status: "draft" });
      await insertWorkflowAsService(inst.institutionId, inst.users.owner.id, { status: "active" });

      const result = await callAs(inst, "owner", workflowListQuery, { status: "active" });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data).toHaveLength(1);
      expect(result.data[0].status).toBe("active");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin can read; a teacher is forbidden", async () => {
    const inst = await createTestInstitution("wf-q-list-roles");
    try {
      await insertWorkflowAsService(inst.institutionId, inst.users.owner.id);

      const asAdmin = await callAs(inst, "admin", workflowListQuery, {});
      expect(asAdmin.ok).toBe(true);

      const asTeacher = await callAs(inst, "teacher", workflowListQuery, {});
      expect(asTeacher).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("owner of B sees no workflows from A", async () => {
    await withTwoInstitutions(async (a, b) => {
      await insertWorkflowAsService(a.institutionId, a.users.owner.id);

      const runsB = await callAs(b, "owner", workflowListQuery, {});
      expect(runsB).toMatchObject({ ok: true, data: [] });
    });
  }, 20000);
});

describe("M23-T17 workflows.runs", () => {
  it("keys equal the WorkflowRun fixture keys; newest first", async () => {
    const inst = await createTestInstitution("wf-q-runs-keys");
    try {
      const wf = await insertWorkflowAsService(inst.institutionId, inst.users.owner.id);
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const older = await insertRunAsService(inst.institutionId, wf.id, {
        trigger_key: `manual:${crypto.randomUUID()}`,
        created_at: hourAgo,
        started_at: hourAgo,
      });
      const newer = await insertRunAsService(inst.institutionId, wf.id, {
        trigger_key: `manual:${crypto.randomUUID()}`,
      });

      const result = await callAs(inst, "owner", workflowRunsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.map((r) => r.id)).toEqual([newer, older]);
      expect(Object.keys(result.data[0]).sort()).toEqual(RUN_KEYS);
    } finally {
      await inst.cleanup();
    }
  });

  it("filters by workflowId and status, and respects limit", async () => {
    const inst = await createTestInstitution("wf-q-runs-filter");
    try {
      const wfA = await insertWorkflowAsService(inst.institutionId, inst.users.owner.id);
      const wfB = await insertWorkflowAsService(inst.institutionId, inst.users.owner.id);
      const runA1 = await insertRunAsService(inst.institutionId, wfA.id, { status: "done", finished_at: new Date().toISOString() });
      await insertRunAsService(inst.institutionId, wfA.id, { status: "running" });
      await insertRunAsService(inst.institutionId, wfB.id, { status: "done", finished_at: new Date().toISOString() });

      const byWorkflow = await callAs(inst, "owner", workflowRunsQuery, { workflowId: wfA.id });
      expect(byWorkflow.ok).toBe(true);
      if (!byWorkflow.ok) throw new Error("unreachable");
      expect(byWorkflow.data).toHaveLength(2);

      const byStatus = await callAs(inst, "owner", workflowRunsQuery, { workflowId: wfA.id, status: "done" });
      expect(byStatus).toMatchObject({ ok: true, data: [{ id: runA1 }] });

      const limited = await callAs(inst, "owner", workflowRunsQuery, { limit: 1 });
      expect(limited.ok).toBe(true);
      if (!limited.ok) throw new Error("unreachable");
      expect(limited.data).toHaveLength(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher is forbidden; owner of B sees no runs from A", async () => {
    await withTwoInstitutions(async (a, b) => {
      const wf = await insertWorkflowAsService(a.institutionId, a.users.owner.id);
      await insertRunAsService(a.institutionId, wf.id);

      const asTeacher = await callAs(a, "teacher", workflowRunsQuery, {});
      expect(asTeacher).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const runsB = await callAs(b, "owner", workflowRunsQuery, {});
      expect(runsB).toMatchObject({ ok: true, data: [] });
    });
  }, 20000);
});
