import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createScenario, decideScenario, deleteScenario, updateScenario } from "@/modules/fabric/simulator.actions";
import { listScenarios, realBaselineFacts, runScenario } from "@/modules/fabric/simulator.queries";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { setActingClient } from "../helpers/server-client-mock";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// live-fabric lane "simulator" (F-UI-08): simulation_scenarios (20261028000106)
// write guard + RLS + the four actions.
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const BASE_ASSUMPTIONS = {
  enrolment_delta_pct: 10,
  staff_delta: 2,
  fee_change_pct: 5,
  cost_change_pct: 3,
  periods_per_day: 8,
  horizon_months: 12,
};

describe("fabric.simulator actions (M106)", () => {
  it("principal creates a scenario; admin may edit the draft but not approve it", async () => {
    const inst = await createTestInstitution("sim-create");
    try {
      const created = await callAs(inst, "principal", createScenario, {
        name: "New wing, +10%",
        rationale: "Model demand for the new wing.",
        assumptions: BASE_ASSUMPTIONS,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const id = created.data.id;

      const updated = await callAs(inst, "admin", updateScenario, {
        id,
        status: "proposed",
      });
      expect(updated.ok).toBe(true);

      const deniedDecision = await callAs(inst, "admin", decideScenario, { id, decision: "approved" });
      expect(deniedDecision.ok).toBe(false);
      if (deniedDecision.ok) return;
      expect(deniedDecision.error.code).toBe("forbidden");

      const decided = await callAs(inst, "principal", decideScenario, { id, decision: "approved" });
      expect(decided.ok).toBe(true);

      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      const rows = await listScenarios(ctx);
      setActingClient(null);
      const row = rows.find((r) => r.id === id);
      expect(row?.status).toBe("approved");
      expect(row?.decidedBy).not.toBeNull();
      expect(row?.decidedAt).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("a decided scenario is frozen: a direct status update back to draft is rejected by the guard trigger", async () => {
    const inst = await createTestInstitution("sim-freeze");
    try {
      const created = await callAs(inst, "owner", createScenario, {
        name: "Freeze probe",
        assumptions: BASE_ASSUMPTIONS,
        status: "proposed",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const id = created.data.id;

      const decided = await callAs(inst, "owner", decideScenario, { id, decision: "rejected" });
      expect(decided.ok).toBe(true);

      const { error } = await inst.clientAs("owner").from("simulation_scenarios").update({ status: "draft" }).eq("id", id);
      expect(error?.message).toMatch(/invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot read or write simulation_scenarios (RLS: owner/principal/admin only)", async () => {
    const inst = await createTestInstitution("sim-rls");
    try {
      const row = await serviceClient()
        .from("simulation_scenarios")
        .insert({
          institution_id: inst.institutionId,
          name: "RLS probe",
          assumptions: BASE_ASSUMPTIONS,
          status: "proposed",
          created_by: inst.users.owner.id,
        })
        .select("id")
        .single();
      expect(row.error).toBeNull();

      const { data, error } = await inst.clientAs("teacher").from("simulation_scenarios").select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      const insertAttempt = await inst
        .clientAs("teacher")
        .from("simulation_scenarios")
        .insert({ institution_id: inst.institutionId, name: "Intrusion", assumptions: BASE_ASSUMPTIONS });
      expect(insertAttempt.error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("deleteScenario removes a draft but the guard keeps a proposed one visible for decision via the normal update path", async () => {
    const inst = await createTestInstitution("sim-delete");
    try {
      const created = await callAs(inst, "admin", createScenario, {
        name: "Delete me",
        assumptions: BASE_ASSUMPTIONS,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const deleted = await callAs(inst, "admin", deleteScenario, { id: created.data.id });
      expect(deleted.ok).toBe(true);

      const ctx = await buildContext(inst, "admin");
      setActingClient(inst.clientAs("admin"));
      const rows = await listScenarios(ctx);
      setActingClient(null);
      expect(rows.find((r) => r.id === created.data.id)).toBeUndefined();
    } finally {
      await inst.cleanup();
    }
  });

  it("realBaselineFacts returns real counts (no crash on a fresh fixture with no billing/timetable data) and runScenario stays pure over them", async () => {
    const inst: TestInstitution = await createTestInstitution("sim-baseline");
    try {
      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      const { facts, costIsAssumption } = await realBaselineFacts(ctx);
      setActingClient(null);
      expect(costIsAssumption).toBe(true);
      expect(facts.students).toBeGreaterThanOrEqual(0);
      expect(facts.teachers).toBeGreaterThanOrEqual(0);
      expect(facts.periods_per_day).toBeGreaterThan(0);
      expect(facts.rooms).toBeGreaterThan(0);

      const a = runScenario(BASE_ASSUMPTIONS, facts);
      const b = runScenario(BASE_ASSUMPTIONS, facts);
      expect(a).toEqual(b);
    } finally {
      await inst.cleanup();
    }
  });
});
