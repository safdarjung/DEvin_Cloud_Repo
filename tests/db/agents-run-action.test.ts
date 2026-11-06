import postgres from "postgres";
import { AGENT_SLUGS } from "@/modules/agents/catalog";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";

// M22-T7 — agent.run / agent.definition.setEnabled. The model loop itself
// (streamAgent → tools → proposals) is T6's own unit coverage; here the
// executor is a canned outcome so this file tests only the action's own
// job: materialise rows, gate on definition state, persist the outcome with
// the guard's finished_at rule, and audit without the task text.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

vi.mock("@/modules/agents/executor", () => ({
  executeAgentRun: vi.fn(),
  logEntry: (level: string, text: string) => ({ at: new Date().toISOString(), level, text: text.slice(0, 200) }),
}));

import { executeAgentRun } from "@/modules/agents/executor";
import { runAgent, setAgentEnabled } from "@/modules/agents/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

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

describe("M22-T7 agent.run", () => {
  it("owner runs finance: awaiting_approval row, human_approved risk, finished_at null, requested_by owner, audit without task text", async () => {
    const inst = await createTestInstitution("agent-run-awaiting");
    try {
      mockedExecuteAgentRun.mockResolvedValue({
        status: "awaiting_approval",
        riskClass: "human_approved",
        summary: "Proposed sending reminders.",
        log: [{ at: new Date().toISOString(), level: "info", text: "Finished: awaiting_approval" }],
        proposals: [
          { action: "finance.reminders.send", input: { termId: "t1" }, risk_class: "human_approved", status: "proposed", error_code: null },
        ],
      });

      const result = await callAs(inst, "owner", runAgent, { slug: "finance", task: "Chase overdue fees for this term." });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.status).toBe("awaiting_approval");

      const [row] = await sql`
        select status, risk_class, finished_at, requested_by from public.agent_runs where id = ${result.data.runId}::uuid
      `;
      expect(row.status).toBe("awaiting_approval");
      expect(row.risk_class).toBe("human_approved");
      expect(row.finished_at).toBeNull();
      expect(row.requested_by).toBe(inst.users.owner.id);

      const auditRows = await sql`
        select after from public.audit_events where entity_id = ${result.data.runId}::uuid and action = 'agent.run'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].after).toMatchObject({ slug: "finance", status: "awaiting_approval", proposals: 1 });
      expect(JSON.stringify(auditRows[0].after)).not.toContain("Chase overdue fees");
    } finally {
      await inst.cleanup();
    }
  });

  it("a canned done outcome sets finished_at", async () => {
    const inst = await createTestInstitution("agent-run-done");
    try {
      mockedExecuteAgentRun.mockResolvedValue({
        status: "done",
        riskClass: "low_risk_reversible",
        summary: "Sent an announcement.",
        log: [],
        proposals: [],
      });

      const result = await callAs(inst, "owner", runAgent, { slug: "finance", task: "x" });
      expect(result).toMatchObject({ ok: true, data: { status: "done" } });
      if (!result.ok) throw new Error("unreachable");

      const [row] = await sql`select status, finished_at from public.agent_runs where id = ${result.data.runId}::uuid`;
      expect(row.status).toBe("done");
      expect(row.finished_at).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("executor throws: the row ends failed and the action still returns ok", async () => {
    const inst = await createTestInstitution("agent-run-throws");
    try {
      mockedExecuteAgentRun.mockRejectedValue(new Error("boom"));

      const result = await callAs(inst, "owner", runAgent, { slug: "finance", task: "x" });
      expect(result).toMatchObject({ ok: true, data: { status: "failed" } });
      if (!result.ok) throw new Error("unreachable");

      const [row] = await sql`select status, finished_at from public.agent_runs where id = ${result.data.runId}::uuid`;
      expect(row.status).toBe("failed");
      expect(row.finished_at).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("a disabled agent: invalid_state, no run row inserted", async () => {
    const inst = await createTestInstitution("agent-run-disabled");
    try {
      await callAs(inst, "principal", setAgentEnabled, { slug: "finance", enabled: false });
      const before = await sql`select count(*)::int as n from public.agent_runs where institution_id = ${inst.institutionId}::uuid`;

      const result = await callAs(inst, "owner", runAgent, { slug: "finance", task: "x" });
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_state" } });

      const after = await sql`select count(*)::int as n from public.agent_runs where institution_id = ${inst.institutionId}::uuid`;
      expect(after[0].n).toBe(before[0].n);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher and accountant cannot run an agent", async () => {
    const inst = await createTestInstitution("agent-run-forbidden-roles");
    try {
      for (const role of ["teacher", "accountant"] as const) {
        const result = await callAs(inst, role, runAgent, { slug: "finance", task: "x" });
        expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("the agents module disabled: forbidden with MODULE_DISABLED_MESSAGE", async () => {
    const inst = await createTestInstitution("agent-run-module-off");
    try {
      await sql`update public.institutions set settings = settings || '{"modules": {"agents": false}}'::jsonb where id = ${inst.institutionId}`;

      const result = await callAs(inst, "owner", runAgent, { slug: "finance", task: "x" });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden", message: MODULE_DISABLED_MESSAGE } });
    } finally {
      await inst.cleanup();
    }
  });
});

describe("M22-T7 agent.definition.setEnabled", () => {
  it("a principal disables finance: stored false, audited", async () => {
    const inst = await createTestInstitution("agent-setenabled-disable");
    try {
      const result = await callAs(inst, "principal", setAgentEnabled, { slug: "finance", enabled: false });
      expect(result).toMatchObject({ ok: true, data: { slug: "finance", enabled: false } });

      const [row] = await sql`
        select is_enabled from public.agent_definitions where institution_id = ${inst.institutionId}::uuid and slug = 'finance'
      `;
      expect(row.is_enabled).toBe(false);

      const auditRows = await sql`
        select after from public.audit_events where institution_id = ${inst.institutionId}::uuid and action = 'agent.definition.enabled_set'
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].after).toMatchObject({ slug: "finance", enabled: false });
    } finally {
      await inst.cleanup();
    }
  });

  it("an admin cannot setEnabled", async () => {
    const inst = await createTestInstitution("agent-setenabled-admin-forbidden");
    try {
      const result = await callAs(inst, "admin", setAgentEnabled, { slug: "finance", enabled: false });
      expect(result).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });

  it("the first call materialises one definition row per catalog slug; a second call adds none", async () => {
    const inst = await createTestInstitution("agent-ensure-idempotent");
    try {
      await callAs(inst, "principal", setAgentEnabled, { slug: "finance", enabled: true });
      const first = await sql`select count(*)::int as n from public.agent_definitions where institution_id = ${inst.institutionId}::uuid`;
      expect(first[0].n).toBe(AGENT_SLUGS.length);

      await callAs(inst, "principal", setAgentEnabled, { slug: "academic", enabled: true });
      const second = await sql`select count(*)::int as n from public.agent_definitions where institution_id = ${inst.institutionId}::uuid`;
      expect(second[0].n).toBe(AGENT_SLUGS.length);
    } finally {
      await inst.cleanup();
    }
  });
});
