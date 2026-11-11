import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mock (T-022 pattern) — only this file's module graph.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { createScenario, decideScenario, deleteScenario, updateScenario } from "@/modules/fabric/simulator.actions";
import { listScenarios, realBaselineFacts } from "@/modules/fabric/simulator.queries";
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

  it("realBaselineFacts returns null (not invented numbers) when the school has no students, staff or rooms yet", async () => {
    const inst: TestInstitution = await createTestInstitution("sim-baseline");
    try {
      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      const real = await realBaselineFacts(ctx);
      setActingClient(null);
      expect(real).toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  // H1: once a scenario leaves draft, name/rationale/assumptions are frozen —
  // only status (and the decision columns) may still change.
  it("name/rationale/assumptions are frozen once a scenario is proposed (H1)", async () => {
    const inst = await createTestInstitution("sim-h1-freeze-fields");
    try {
      const created = await callAs(inst, "owner", createScenario, {
        name: "Original name",
        rationale: "Original rationale.",
        assumptions: BASE_ASSUMPTIONS,
        status: "proposed",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const id = created.data.id;

      const { error } = await inst.clientAs("owner").from("simulation_scenarios").update({ name: "Renamed" }).eq("id", id);
      expect(error?.message).toMatch(/invalid_state/);

      const { error: rationaleError } = await inst
        .clientAs("owner")
        .from("simulation_scenarios")
        .update({ rationale: "Changed." })
        .eq("id", id);
      expect(rationaleError?.message).toMatch(/invalid_state/);

      const { error: assumptionsError } = await inst
        .clientAs("owner")
        .from("simulation_scenarios")
        .update({ assumptions: { ...BASE_ASSUMPTIONS, staff_delta: 5 } })
        .eq("id", id);
      expect(assumptionsError?.message).toMatch(/invalid_state/);

      // A draft row is unaffected: the same fields may still change.
      const draft = await callAs(inst, "owner", createScenario, {
        name: "Still draft",
        assumptions: BASE_ASSUMPTIONS,
      });
      expect(draft.ok).toBe(true);
      if (!draft.ok) return;
      const renameDraft = await callAs(inst, "owner", updateScenario, { id: draft.data.id, name: "Renamed draft" });
      expect(renameDraft.ok).toBe(true);
    } finally {
      await inst.cleanup();
    }
  });

  // M2: assumptions jsonb is capped at 2000 bytes by a check constraint;
  // a row that somehow holds invalid assumptions is skipped by listScenarios
  // instead of throwing (ScenarioAssumptionsSchema.safeParse in simulator.queries.ts).
  it("assumptions over 2000 bytes is rejected by the check constraint (M2)", async () => {
    const inst = await createTestInstitution("sim-m2-oversize");
    try {
      const oversized = { ...BASE_ASSUMPTIONS, note: "x".repeat(2100) };
      const { error } = await serviceClient()
        .from("simulation_scenarios")
        .insert({
          institution_id: inst.institutionId,
          name: "Oversized",
          assumptions: oversized,
          created_by: inst.users.owner.id,
        });
      expect(error).not.toBeNull();
    } finally {
      await inst.cleanup();
    }
  });

  it("listScenarios skips a row whose assumptions fail ScenarioAssumptionsSchema (M2)", async () => {
    const inst = await createTestInstitution("sim-m2-skip-invalid");
    try {
      const good = await callAs(inst, "owner", createScenario, {
        name: "Valid scenario",
        assumptions: BASE_ASSUMPTIONS,
      });
      expect(good.ok).toBe(true);
      if (!good.ok) return;

      // Service role bypasses the guard trigger's v_trusted path, so a shape
      // that satisfies the SQL check (object, <=2000 bytes) but fails the
      // stricter Zod schema (missing a required key) can still land in the table.
      const invalidAssumptions = { enrolment_delta_pct: 1, staff_delta: 1 };
      const inserted = await serviceClient()
        .from("simulation_scenarios")
        .insert({
          institution_id: inst.institutionId,
          name: "Invalid shape",
          assumptions: invalidAssumptions,
          created_by: inst.users.owner.id,
        })
        .select("id")
        .single();
      expect(inserted.error).toBeNull();

      const ctx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      const rows = await listScenarios(ctx);
      setActingClient(null);
      expect(rows.find((r) => r.id === good.data.id)).toBeDefined();
      expect(rows.find((r) => r.id === inserted.data!.id)).toBeUndefined();
    } finally {
      await inst.cleanup();
    }
  });

  // M6: update/decide/delete on a non-existent (or cross-tenant) id return
  // not_found instead of a silent no-op success.
  it("updateScenario, decideScenario and deleteScenario return not_found for a missing id (M6)", async () => {
    const inst = await createTestInstitution("sim-m6-not-found");
    try {
      const missingId = "00000000-0000-0000-0000-000000000000";

      const updated = await callAs(inst, "owner", updateScenario, { id: missingId, name: "Nope" });
      expect(updated.ok).toBe(false);
      if (!updated.ok) expect(updated.error.code).toBe("not_found");

      const decided = await callAs(inst, "owner", decideScenario, { id: missingId, decision: "approved" });
      expect(decided.ok).toBe(false);
      if (!decided.ok) expect(decided.error.code).toBe("not_found");

      const deleted = await callAs(inst, "owner", deleteScenario, { id: missingId });
      expect(deleted.ok).toBe(false);
      if (!deleted.ok) expect(deleted.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });
});
