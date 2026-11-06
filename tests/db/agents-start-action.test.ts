import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";

// M23-T19 — agent.start starts a queued agent_runs row (queued by a
// workflow's agent node, not modelled here) in-request as the caller. The
// model loop itself is M22-T6's own coverage; here the executor is a canned
// outcome so this file tests only the gate order (rulings "agent.start"
// steps 1-6): status, who may decide a `user_confirmed` run, the
// definition's enabled flag, the claim's conflict guard, and the audit
// entry that never carries the task text.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

vi.mock("@/modules/agents/executor", () => ({
  executeAgentRun: vi.fn(),
  logEntry: (level: string, text: string) => ({ at: new Date().toISOString(), level, text: text.slice(0, 200) }),
}));

import { executeAgentRun } from "@/modules/agents/executor";
import { startAgentRun } from "@/modules/agents/actions";
import { AGENT_CATALOG_VERSION } from "@/modules/agents/catalog";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const mockedExecuteAgentRun = vi.mocked(executeAgentRun);

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

beforeEach(() => {
  mockedExecuteAgentRun.mockReset();
});

async function insertDefinition(inst: TestInstitution, slug: string, isEnabled: boolean): Promise<string> {
  const [row] = await sql`
    insert into public.agent_definitions (institution_id, slug, is_enabled)
    values (${inst.institutionId}::uuid, ${slug}, ${isEnabled})
    returning id
  `;
  return row.id as string;
}

async function insertQueuedRun(inst: TestInstitution, agentId: string, requestedById: string, task = "Review admission enquiries."): Promise<string> {
  const [row] = await sql`
    insert into public.agent_runs (institution_id, agent_id, task, requested_by, catalog_version, status)
    values (${inst.institutionId}::uuid, ${agentId}::uuid, ${task}, ${requestedById}::uuid, ${AGENT_CATALOG_VERSION}, 'queued')
    returning id
  `;
  return row.id as string;
}

describe("M23-T19 agent.start", () => {
  it("the requester starts their own queued run: executor runs once, row leaves queued, audit without task text", async () => {
    const inst = await createTestInstitution("agent-start-requester");
    try {
      const agentId = await insertDefinition(inst, "admissions", true);
      const runId = await insertQueuedRun(inst, agentId, inst.users.principal.id, "Draft follow-up notes.");

      mockedExecuteAgentRun.mockResolvedValue({
        status: "done",
        riskClass: "low_risk_reversible",
        summary: "Drafted 2 follow-up notes.",
        log: [],
        proposals: [],
      });

      const result = await callAs(inst, "principal", startAgentRun, { runId });
      expect(result).toMatchObject({ ok: true, data: { runId, status: "done" } });

      expect(mockedExecuteAgentRun).toHaveBeenCalledTimes(1);
      expect(mockedExecuteAgentRun).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ runId, slug: "admissions", task: "Draft follow-up notes." }),
      );

      const [row] = await sql`select status, finished_at, started_at from public.agent_runs where id = ${runId}::uuid`;
      expect(row.status).toBe("done");
      expect(row.finished_at).not.toBeNull();
      expect(row.started_at).not.toBeNull();

      const auditRows = await sql`
        select after from public.audit_events where entity_id = ${runId}::uuid and action = 'agent.start'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].after).toMatchObject({ slug: "admissions", status: "done" });
      expect(JSON.stringify(auditRows[0].after)).not.toContain("Draft follow-up notes");
    } finally {
      await inst.cleanup();
    }
  });

  it("a second start on the same (now terminal) run: invalid_state", async () => {
    const inst = await createTestInstitution("agent-start-twice");
    try {
      const agentId = await insertDefinition(inst, "admissions", true);
      const runId = await insertQueuedRun(inst, agentId, inst.users.principal.id);

      mockedExecuteAgentRun.mockResolvedValue({
        status: "done",
        riskClass: "low_risk_reversible",
        summary: "ok",
        log: [],
        proposals: [],
      });

      const first = await callAs(inst, "principal", startAgentRun, { runId });
      expect(first.ok).toBe(true);

      const second = await callAs(inst, "principal", startAgentRun, { runId });
      expect(second).toMatchObject({ ok: false, error: { code: "invalid_state" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("two concurrent starts on one queued run: one ok, one conflict, executor runs once", async () => {
    const inst = await createTestInstitution("agent-start-concurrent");
    try {
      const agentId = await insertDefinition(inst, "admissions", true);
      const runId = await insertQueuedRun(inst, agentId, inst.users.principal.id);

      mockedExecuteAgentRun.mockResolvedValue({
        status: "done",
        riskClass: "low_risk_reversible",
        summary: "ok",
        log: [],
        proposals: [],
      });

      const [first, second] = await Promise.all([
        callAs(inst, "principal", startAgentRun, { runId }),
        callAs(inst, "principal", startAgentRun, { runId }),
      ]);

      const codes = [first, second].map((r) => (r.ok ? "ok" : r.error.code)).sort();
      // The loser sees `conflict` if it overlaps the winner's claim, `invalid_state` if it lands after the
      // (mocked, instant) run already finished — either way exactly one start wins.
      expect(codes).toHaveLength(2);
      expect(codes.filter((c) => c === "ok")).toHaveLength(1);
      expect(codes.find((c) => c !== "ok")).toMatch(/^(conflict|invalid_state)$/);
      expect(mockedExecuteAgentRun).toHaveBeenCalledTimes(1);
    } finally {
      await inst.cleanup();
    }
  });

  it("an admin who did not request the run: forbidden", async () => {
    const inst = await createTestInstitution("agent-start-admin-forbidden");
    try {
      const agentId = await insertDefinition(inst, "admissions", true);
      const runId = await insertQueuedRun(inst, agentId, inst.users.principal.id);

      const result = await callAs(inst, "admin", startAgentRun, { runId });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      expect(mockedExecuteAgentRun).not.toHaveBeenCalled();

      const [row] = await sql`select status from public.agent_runs where id = ${runId}::uuid`;
      expect(row.status).toBe("queued");
    } finally {
      await inst.cleanup();
    }
  });

  it("an owner who holds agent.approve can start someone else's queued run", async () => {
    const inst = await createTestInstitution("agent-start-owner-approver");
    try {
      const agentId = await insertDefinition(inst, "admissions", true);
      const runId = await insertQueuedRun(inst, agentId, inst.users.principal.id);

      mockedExecuteAgentRun.mockResolvedValue({
        status: "awaiting_approval",
        riskClass: "human_approved",
        summary: "Needs approval.",
        log: [],
        proposals: [],
      });

      const result = await callAs(inst, "owner", startAgentRun, { runId });
      expect(result).toMatchObject({ ok: true, data: { status: "awaiting_approval" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a disabled agent definition: invalid_state, run stays queued", async () => {
    const inst = await createTestInstitution("agent-start-disabled");
    try {
      const agentId = await insertDefinition(inst, "admissions", false);
      const runId = await insertQueuedRun(inst, agentId, inst.users.owner.id);

      const result = await callAs(inst, "owner", startAgentRun, { runId });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_state" } });
      expect(mockedExecuteAgentRun).not.toHaveBeenCalled();

      const [row] = await sql`select status from public.agent_runs where id = ${runId}::uuid`;
      expect(row.status).toBe("queued");
    } finally {
      await inst.cleanup();
    }
  });

  it("the agents module disabled: forbidden with MODULE_DISABLED_MESSAGE", async () => {
    const inst = await createTestInstitution("agent-start-module-off");
    try {
      await sql`update public.institutions set settings = settings || '{"modules": {"agents": false}}'::jsonb where id = ${inst.institutionId}`;

      const result = await callAs(inst, "owner", startAgentRun, { runId: crypto.randomUUID() });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    } finally {
      await inst.cleanup();
    }
  });

  it("a teacher cannot start an agent run", async () => {
    const inst = await createTestInstitution("agent-start-teacher-forbidden");
    try {
      const result = await callAs(inst, "teacher", startAgentRun, { runId: crypto.randomUUID() });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });
});
