import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

// Opt-in mocks (BRIEF-COMMON lesson 13).
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { updateIntervention } from "@/modules/mastery/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { buildMasteryFixture, closeMasteryFixtureHelper, insertGapPlan } from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

describe("M20-T10 mastery.intervention.update", () => {
  it("class teacher accepts the plan and ticks a step", async () => {
    const inst = await createTestInstitution("mastery-ivn-action-accept");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");

      const result = await callAs(inst, "teacher", updateIntervention, {
        id: plan.actionId,
        status: "active",
        steps: [{ title: "Re-teach: Algebra basics (Maths)", due: "2026-12-01", done: true }],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ id: plan.actionId, status: "active" });

      const [row] = await sql`
        select intervention_status, steps, status from public.insight_actions where id = ${plan.actionId}
      `;
      expect(row.intervention_status).toBe("active");
      expect(row.status).toBe("planned");
      expect(row.steps).toEqual([{ title: "Re-teach: Algebra basics (Maths)", due: "2026-12-01", done: true }]);

      const [auditRow] = await sql`
        select metadata from public.audit_events
        where entity_id = ${plan.actionId}::uuid and action = 'mastery.intervention.updated'
        order by created_at desc limit 1
      `;
      expect(auditRow.metadata).toEqual({ id: plan.actionId, from: "proposed", to: "active" });
      expect(JSON.stringify(auditRow.metadata)).not.toMatch(/goal|title|Re-teach/i);
    } finally {
      await inst.cleanup();
    }
  });

  it("principal closes an active plan", async () => {
    const inst = await createTestInstitution("mastery-ivn-action-close");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "active");

      const result = await callAs(inst, "principal", updateIntervention, { id: plan.actionId, status: "closed" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual({ id: plan.actionId, status: "closed" });

      const [row] = await sql`select intervention_status, status from public.insight_actions where id = ${plan.actionId}`;
      expect(row.intervention_status).toBe("closed");
      expect(row.status).toBe("done");
    } finally {
      await inst.cleanup();
    }
  });

  it("proposed to review is an invalid transition", async () => {
    const inst = await createTestInstitution("mastery-ivn-action-bad-edge");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");

      const result = await callAs(inst, "teacher", updateIntervention, { id: plan.actionId, status: "review" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("editing a closed plan is an invalid state", async () => {
    const inst = await createTestInstitution("mastery-ivn-action-closed-edit");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "closed");

      const result = await callAs(inst, "teacher", updateIntervention, {
        id: plan.actionId,
        goal: "New goal for the plan",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_state");
    } finally {
      await inst.cleanup();
    }
  });

  it("admin (not owner/principal/class teacher) gets not_found", async () => {
    const inst = await createTestInstitution("mastery-ivn-action-admin");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");

      const result = await callAs(inst, "admin", updateIntervention, { id: plan.actionId, status: "active" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("not_found");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian is forbidden (no mastery.review permission)", async () => {
    const inst = await createTestInstitution("mastery-ivn-action-guardian");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");

      const result = await callAs(inst, "guardian", updateIntervention, { id: plan.actionId, status: "active" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
