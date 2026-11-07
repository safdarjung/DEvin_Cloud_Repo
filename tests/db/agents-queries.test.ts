import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// M22-T9 — agents.definitions / agents.runs / agents.runDetail. Mirrors
// tests/db/agents-rls.test.ts's direct service-role fixture helpers (runs
// are server-write-only — no action in this packet inserts the varied
// statuses these tests need) and tests/db/audit-list-query.test.ts's
// callAs-against-a-query style (opt-in mock so the queries' own
// createClient() calls run as the fixture role's real signed-in client).
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { agentDefinitionsQuery, agentRunDetailQuery, agentRunsQuery } from "@/modules/agents/query-defs";
import { AGENT_SLUGS } from "@/modules/agents/catalog";
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

async function insertRun(
  institutionId: string,
  agentId: string,
  requestedBy: string,
  overrides: Partial<{
    status: string;
    riskClass: string;
    finishedAt: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
    decisionNote: string | null;
    proposals: unknown[];
  }> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_runs")
    .insert({
      institution_id: institutionId,
      agent_id: agentId,
      requested_by: requestedBy,
      task: "Probe task",
      status: overrides.status ?? "running",
      risk_class: overrides.riskClass ?? "read_only",
      catalog_version: "agents_v1",
      started_at: new Date().toISOString(),
      finished_at: overrides.finishedAt ?? null,
      decided_by: overrides.decidedBy ?? null,
      decided_at: overrides.decidedAt ?? null,
      decision_note: overrides.decisionNote ?? null,
      proposals: overrides.proposals ?? [],
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function financeId(ownerResult: { ok: true; data: { slug: string; id: string }[] }): Promise<string> {
  return ownerResult.data.find((d) => d.slug === "finance")!.id;
}

describe("M22-T9 agents.definitions", () => {
  it("one row per catalog agent, in catalog order; finance has no exams.* tool, human_approved max risk, local tier, null quality", async () => {
    const inst = await createTestInstitution("agents-q-definitions");
    try {
      const result = await callAs(inst, "owner", agentDefinitionsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("unreachable");
      expect(result.data.map((d) => d.slug)).toEqual([...AGENT_SLUGS]);

      const finance = result.data.find((d) => d.slug === "finance")!;
      expect(finance.tools.some((t) => t.startsWith("exams."))).toBe(false);
      expect(finance.max_risk_class).toBe("human_approved");
      expect(finance.model_tier).toBe("local");
      expect(finance.quality_score).toBeNull();
      expect(finance.runs_30d).toBe(0);
      expect(finance.error_rate_pct).toBe(0);

      const rows = await sql`select count(*)::int as n from public.agent_definitions where institution_id = ${inst.institutionId}::uuid`;
      expect(rows[0].n).toBe(AGENT_SLUGS.length);
    } finally {
      await inst.cleanup();
    }
  });

  it("3 runs (2 done, 1 failed) -> runs_30d 3, error_rate_pct 33; a 0.5 USD usage row on one run -> cost_paise_30d 4200", async () => {
    const inst = await createTestInstitution("agents-q-stats");
    try {
      const defs = await callAs(inst, "owner", agentDefinitionsQuery, {});
      if (!defs.ok) throw new Error("unreachable");
      const agentId = await financeId(defs);
      const now = new Date().toISOString();

      const run1 = await insertRun(inst.institutionId, agentId, inst.users.owner.id, { status: "done", finishedAt: now });
      await insertRun(inst.institutionId, agentId, inst.users.owner.id, { status: "done", finishedAt: now });
      await insertRun(inst.institutionId, agentId, inst.users.owner.id, { status: "failed", finishedAt: now });

      const usage = await serviceClient().from("ai_usage_events").insert({
        institution_id: inst.institutionId,
        feature: "agent.finance",
        provider: "local",
        model: "test",
        input_tokens: 1,
        output_tokens: 1,
        latency_ms: 1,
        cost_estimate_usd: 0.5,
        ok: true,
        agent_run_id: run1,
      });
      expect(usage.error).toBeNull();

      const after = await callAs(inst, "owner", agentDefinitionsQuery, {});
      if (!after.ok) throw new Error("unreachable");
      const finance = after.data.find((d) => d.slug === "finance")!;
      expect(finance.runs_30d).toBe(3);
      expect(finance.error_rate_pct).toBe(33);
      expect(finance.cost_paise_30d).toBe(4200);
    } finally {
      await inst.cleanup();
    }
  });
});

describe("M22-T9 agents.runs", () => {
  it("filters by slug and status; approver is the decider's profile name; cost_paise reflects usage rows", async () => {
    const inst = await createTestInstitution("agents-q-runs-filter");
    try {
      const defs = await callAs(inst, "owner", agentDefinitionsQuery, {});
      if (!defs.ok) throw new Error("unreachable");
      const financeAgentId = await financeId(defs);
      const academicAgentId = defs.data.find((d) => d.slug === "academic")!.id;

      await sql`update public.profiles set full_name = 'Principal Priya' where id = ${inst.users.principal.id}`;

      const runningFinance = await insertRun(inst.institutionId, financeAgentId, inst.users.owner.id, { status: "running" });
      const doneAcademic = await insertRun(inst.institutionId, academicAgentId, inst.users.owner.id, {
        status: "done",
        finishedAt: new Date().toISOString(),
      });
      const decidedFinance = await insertRun(inst.institutionId, financeAgentId, inst.users.owner.id, {
        status: "done",
        riskClass: "human_approved",
        finishedAt: new Date().toISOString(),
        decidedBy: inst.users.principal.id,
        decidedAt: new Date().toISOString(),
      });
      const usage = await serviceClient().from("ai_usage_events").insert({
        institution_id: inst.institutionId,
        feature: "agent.finance",
        provider: "local",
        model: "test",
        input_tokens: 1,
        output_tokens: 1,
        latency_ms: 1,
        cost_estimate_usd: 0.5,
        ok: true,
        agent_run_id: decidedFinance,
      });
      expect(usage.error).toBeNull();

      const bySlug = await callAs(inst, "owner", agentRunsQuery, { slug: "finance", limit: 50 });
      if (!bySlug.ok) throw new Error("unreachable");
      expect(bySlug.data.map((r) => r.id).sort()).toEqual([runningFinance, decidedFinance].sort());

      const byStatus = await callAs(inst, "owner", agentRunsQuery, { status: "done", limit: 50 });
      if (!byStatus.ok) throw new Error("unreachable");
      const ids = byStatus.data.map((r) => r.id);
      expect(ids).toContain(doneAcademic);
      expect(ids).toContain(decidedFinance);
      expect(ids).not.toContain(runningFinance);

      const decidedRow = byStatus.data.find((r) => r.id === decidedFinance)!;
      expect(decidedRow.approver).toBe("Principal Priya");
      expect(decidedRow.cost_paise).toBe(4200);

      const newestFirst = await callAs(inst, "owner", agentRunsQuery, { limit: 50 });
      if (!newestFirst.ok) throw new Error("unreachable");
      const createdAts = newestFirst.data.map((r) => new Date(r.created_at).getTime());
      expect(createdAts).toEqual([...createdAts].sort((a, b) => b - a));
    } finally {
      await inst.cleanup();
    }
  });
});

describe("M22-T9 agents.runDetail", () => {
  it("returns proposals and decisionNote; canDecide true for principal, false for admin, on a human_approved run", async () => {
    const inst = await createTestInstitution("agents-q-rundetail");
    try {
      const defs = await callAs(inst, "owner", agentDefinitionsQuery, {});
      if (!defs.ok) throw new Error("unreachable");
      const agentId = await financeId(defs);
      await sql`update public.profiles set full_name = 'Owner Olu' where id = ${inst.users.owner.id}`;
      const proposals = [
        { action: "finance.reminders.send", input: { termId: "t1" }, risk_class: "human_approved", status: "proposed", error_code: null },
      ];
      const runId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, {
        status: "awaiting_approval",
        riskClass: "human_approved",
        proposals,
        decisionNote: "please review",
      });

      const asPrincipal = await callAs(inst, "principal", agentRunDetailQuery, { runId });
      expect(asPrincipal.ok).toBe(true);
      if (!asPrincipal.ok) throw new Error("unreachable");
      expect(asPrincipal.data.proposals).toEqual(proposals);
      expect(asPrincipal.data.canDecide).toBe(true);
      expect(asPrincipal.data.decisionNote).toBe("please review");
      expect(asPrincipal.data.run.id).toBe(runId);
      expect(asPrincipal.data.requestedBy).toBe("Owner Olu");

      const asAdmin = await callAs(inst, "admin", agentRunDetailQuery, { runId });
      expect(asAdmin.ok).toBe(true);
      if (!asAdmin.ok) throw new Error("unreachable");
      expect(asAdmin.data.canDecide).toBe(false);
    } finally {
      await inst.cleanup();
    }
  });

  it("a missing run id is not_found", async () => {
    const inst = await createTestInstitution("agents-q-rundetail-missing");
    try {
      const result = await callAs(inst, "owner", agentRunDetailQuery, { runId: crypto.randomUUID() });
      expect(result).toMatchObject({ ok: false, error: { code: "not_found" } });
    } finally {
      await inst.cleanup();
    }
  });
});

describe("M22-T9 cross-institution and role gates", () => {
  it("owner of B sees no runs from A; runDetail of A's run is not_found for B", async () => {
    await withTwoInstitutions(async (a, b) => {
      const defsA = await callAs(a, "owner", agentDefinitionsQuery, {});
      if (!defsA.ok) throw new Error("unreachable");
      const agentIdA = await financeId(defsA);
      const runA = await insertRun(a.institutionId, agentIdA, a.users.owner.id, { status: "running" });

      const runsB = await callAs(b, "owner", agentRunsQuery, {});
      expect(runsB).toMatchObject({ ok: true, data: [] });

      const detailB = await callAs(b, "owner", agentRunDetailQuery, { runId: runA });
      expect(detailB).toMatchObject({ ok: false, error: { code: "not_found" } });
    });
  }, 20000);

  it("a teacher is forbidden on all three queries", async () => {
    const inst = await createTestInstitution("agents-q-teacher-forbidden");
    try {
      const defs = await callAs(inst, "teacher", agentDefinitionsQuery, {});
      expect(defs).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const runs = await callAs(inst, "teacher", agentRunsQuery, {});
      expect(runs).toMatchObject({ ok: false, error: { code: "forbidden" } });

      const detail = await callAs(inst, "teacher", agentRunDetailQuery, { runId: crypto.randomUUID() });
      expect(detail).toMatchObject({ ok: false, error: { code: "forbidden" } });
    } finally {
      await inst.cleanup();
    }
  });
});
