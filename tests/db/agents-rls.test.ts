import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

// Direct service-role client (supabase-js, not the raw `sql` connection
// below): exercises the real table/column grants from the migration, not
// just RLS — same shape as tests/helpers/roles.ts's internal adminClient().
function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

async function insertDefinition(
  institutionId: string,
  overrides: Partial<{ slug: string; isEnabled: boolean }> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from("agent_definitions")
    .insert({ institution_id: institutionId, slug: overrides.slug ?? "finance", is_enabled: overrides.isEnabled ?? true })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function insertRun(
  institutionId: string,
  agentId: string,
  requestedBy: string,
  overrides: Partial<{
    status: string;
    riskClass: string;
    catalogVersion: string;
    finishedAt: string | null;
    decidedBy: string | null;
    decidedAt: string | null;
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
      catalog_version: overrides.catalogVersion ?? "agents_v1",
      started_at: new Date().toISOString(),
      finished_at: overrides.finishedAt ?? null,
      decided_by: overrides.decidedBy ?? null,
      decided_at: overrides.decidedAt ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

describe("agents migration (0095) RLS + grants", () => {
  it("principal toggles is_enabled; admin's update matches 0 rows; teacher/guardian see nothing; slug is not grantable", async () => {
    const inst = await createTestInstitution("agents-definitions");
    try {
      const agentId = await insertDefinition(inst.institutionId);

      const principalUpdate = await inst.clientAs("principal").from("agent_definitions").update({ is_enabled: false }).eq("id", agentId).select("id");
      expect(principalUpdate.error).toBeNull();
      expect(principalUpdate.data).toHaveLength(1);

      const adminUpdate = await inst.clientAs("admin").from("agent_definitions").update({ is_enabled: true }).eq("id", agentId).select("id");
      expect(adminUpdate.error).toBeNull();
      expect(adminUpdate.data).toHaveLength(0);

      for (const role of ["teacher", "guardian"] as const) {
        const { data, error } = await inst.clientAs(role).from("agent_definitions").select("id").eq("id", agentId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }

      const slugUpdate = await inst.clientAs("principal").from("agent_definitions").update({ slug: "academic" }).eq("id", agentId);
      expect(slugUpdate.error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("owner cannot INSERT or UPDATE agent_runs (42501); owner of A sees only A's runs, accountant sees none", async () => {
    const instA = await createTestInstitution("agents-runs-a");
    const instB = await createTestInstitution("agents-runs-b");
    try {
      const agentA = await insertDefinition(instA.institutionId);
      const agentB = await insertDefinition(instB.institutionId);
      const runA = await insertRun(instA.institutionId, agentA, instA.users.owner.id);
      await insertRun(instB.institutionId, agentB, instB.users.owner.id);

      const insertAttempt = await instA.clientAs("owner").from("agent_runs").insert({
        institution_id: instA.institutionId,
        agent_id: agentA,
        requested_by: instA.users.owner.id,
        task: "Probe",
        catalog_version: "agents_v1",
      });
      expect(insertAttempt.error?.code).toBe("42501");

      const updateAttempt = await instA.clientAs("owner").from("agent_runs").update({ summary: "x" }).eq("id", runA);
      expect(updateAttempt.error?.code).toBe("42501");

      const ownerRuns = await instA.clientAs("owner").from("agent_runs").select("id");
      expect(ownerRuns.error).toBeNull();
      expect((ownerRuns.data ?? []).map((r) => r.id)).toEqual([runA]);

      const accountantRuns = await instA.clientAs("accountant").from("agent_runs").select("id");
      expect(accountantRuns.error).toBeNull();
      expect(accountantRuns.data).toEqual([]);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 15000);

  it("guard: running->done ok; done->running invalid_state; awaiting_approval->running without decided_by invalid_state", async () => {
    const inst = await createTestInstitution("agents-guard-transitions");
    try {
      const agentId = await insertDefinition(inst.institutionId);
      const doneRunId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, { status: "running" });

      const toDone = await serviceClient()
        .from("agent_runs")
        .update({ status: "done", finished_at: new Date().toISOString() })
        .eq("id", doneRunId);
      expect(toDone.error).toBeNull();

      const backToRunning = await serviceClient().from("agent_runs").update({ status: "running" }).eq("id", doneRunId);
      expect(backToRunning.error?.message).toContain("code:invalid_state");

      const awaitingRunId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, {
        status: "awaiting_approval",
        riskClass: "human_approved",
      });
      const claimWithoutDecision = await serviceClient().from("agent_runs").update({ status: "running" }).eq("id", awaitingRunId);
      expect(claimWithoutDecision.error?.message).toContain("code:invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("check constraints: awaiting_approval with read_only risk is 23514; risk_class prohibited is 23514", async () => {
    const inst = await createTestInstitution("agents-guard-checks");
    try {
      const agentId = await insertDefinition(inst.institutionId);

      await expect(
        insertRun(inst.institutionId, agentId, inst.users.owner.id, { status: "awaiting_approval", riskClass: "read_only" }),
      ).rejects.toMatchObject({ code: "23514" });

      await expect(insertRun(inst.institutionId, agentId, inst.users.owner.id, { riskClass: "prohibited" })).rejects.toMatchObject({
        code: "23514",
      });
    } finally {
      await inst.cleanup();
    }
  });

  // Security review LOW: agent_runs_rejected_decided_check required decided_by
  // alone; decided_at could stay null on a terminal `rejected` row via a
  // direct INSERT (guard trigger only covers UPDATE). Fixed to require both.
  it("check constraint: rejected with decided_by but no decided_at is 23514; both set is ok", async () => {
    const inst = await createTestInstitution("agents-guard-rejected-decided");
    try {
      const agentId = await insertDefinition(inst.institutionId);

      await expect(
        insertRun(inst.institutionId, agentId, inst.users.owner.id, {
          status: "rejected",
          riskClass: "human_approved",
          finishedAt: new Date().toISOString(),
          decidedBy: inst.users.owner.id,
          decidedAt: null,
        }),
      ).rejects.toMatchObject({ code: "23514" });

      const okRunId = await insertRun(inst.institutionId, agentId, inst.users.owner.id, {
        status: "rejected",
        riskClass: "human_approved",
        finishedAt: new Date().toISOString(),
        decidedBy: inst.users.owner.id,
        decidedAt: new Date().toISOString(),
      });
      expect(okRunId).toBeTruthy();
    } finally {
      await inst.cleanup();
    }
  });

  it("a run pointed at another institution's agent is rejected (23503); a usage row with agent_run_id inserts", async () => {
    const instA = await createTestInstitution("agents-cross-fk-a");
    const instB = await createTestInstitution("agents-cross-fk-b");
    try {
      const agentB = await insertDefinition(instB.institutionId);

      await expect(insertRun(instA.institutionId, agentB, instA.users.owner.id)).rejects.toMatchObject({ code: "23503" });

      const agentA = await insertDefinition(instA.institutionId);
      const runA = await insertRun(instA.institutionId, agentA, instA.users.owner.id);

      const usage = await serviceClient()
        .from("ai_usage_events")
        .insert({
          institution_id: instA.institutionId,
          feature: "agent.finance",
          provider: "local",
          model: "test",
          input_tokens: 1,
          output_tokens: 1,
          latency_ms: 1,
          cost_estimate_usd: 0,
          ok: true,
          agent_run_id: runA,
        })
        .select("id");
      expect(usage.error).toBeNull();
      expect(usage.data).toHaveLength(1);
    } finally {
      await instA.cleanup();
      await instB.cleanup();
    }
  }, 15000);
});
