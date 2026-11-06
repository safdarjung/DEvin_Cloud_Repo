// M20-T6 — interventions on insight_actions: app.guard_intervention state
// machine + RLS (migration 0093 part 3, M20-tasks.md Task 6 TEST FIRST).
import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { buildMasteryFixture, closeMasteryFixtureHelper, insertGapPlan } from "../helpers/mastery-fixture";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeMasteryFixtureHelper();
  await closeRolesHelper();
});

/** A plain `kind = 'action'` insight_actions row, service role (M19 shape). */
async function insertPlainAction(inst: TestInstitution): Promise<{ insightId: string; actionId: string }> {
  const [insight] = await sql`
    insert into public.insights (
      institution_id, signal, detector_version, dedupe_key, domain, kind, severity,
      title, pattern, evidence, date_from, date_to, confidence, reviewer_role
    )
    values (
      ${inst.institutionId}, 'academics.marks_decline', 1, ${`plain-${crypto.randomUUID()}`},
      'academics', 'descriptive', 'warning', 'Marks declining', 'Marks fell over 4 weeks.',
      ${sql.json([{ label: "Drop", value: 10 }])}, '2026-09-01', '2026-10-01', 0.6, 'exam_controller'
    )
    returning id
  `;
  const [action] = await sql`
    insert into public.insight_actions (institution_id, insight_id, action, owner, rationale, expected_outcome, status, created_by)
    values (${inst.institutionId}, ${insight.id}, 'Review', 'Exam office', 'Routine review.', 'Confirm trend.', 'planned', ${inst.users.owner.id})
    returning id
  `;
  return { insightId: insight.id as string, actionId: action.id as string };
}

describe("insight_actions interventions RLS + guard_intervention (M20-T6)", () => {
  it("class teacher reads the fixture student's plan and moves it proposed to active", async () => {
    const inst = await createTestInstitution("mastery-ivn-teacher");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture);

      const read = await inst.clientAs("teacher").from("insight_actions").select("id, intervention_status").eq("id", plan.actionId);
      expect(read.error).toBeNull();
      expect(read.data).toHaveLength(1);
      expect(read.data?.[0].intervention_status).toBe("proposed");

      const update = await inst
        .clientAs("teacher")
        .from("insight_actions")
        .update({ intervention_status: "active" })
        .eq("id", plan.actionId)
        .select("intervention_status, status");
      expect(update.error).toBeNull();
      expect(update.data).toHaveLength(1);
      expect(update.data?.[0].intervention_status).toBe("active");
      expect(update.data?.[0].status).toBe("planned");
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher cannot read B1's plan (teaches B, not its class teacher)", async () => {
    const inst = await createTestInstitution("mastery-ivn-teacher-scope");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.b1);

      const { data, error } = await inst.clientAs("teacher").from("insight_actions").select("id").eq("id", plan.actionId);
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });

  it("admin and exam_controller read 0 plans but still read a plain action row", async () => {
    const inst = await createTestInstitution("mastery-ivn-admin-tier");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture);
      const plainAction = await insertPlainAction(inst);

      for (const role of ["admin", "exam_controller"] as const) {
        const plans = await inst.clientAs(role).from("insight_actions").select("id").eq("id", plan.actionId);
        expect(plans.error).toBeNull();
        expect(plans.data).toHaveLength(0);

        const plain = await inst.clientAs(role).from("insight_actions").select("id").eq("id", plainAction.actionId);
        expect(plain.error).toBeNull();
        expect(plain.data).toHaveLength(1);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("principal reads all plans", async () => {
    const inst = await createTestInstitution("mastery-ivn-principal");
    try {
      const fx = await buildMasteryFixture(inst);
      const a = await insertGapPlan(inst, fx, fx.students.fixture);
      const b = await insertGapPlan(inst, fx, fx.students.b1);
      const c = await insertGapPlan(inst, fx, fx.students.c1);

      const { data, error } = await inst.clientAs("principal").from("insight_actions").select("id");
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.id as string).sort()).toEqual([a.actionId, b.actionId, c.actionId].sort());
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian and student read 0 plans", async () => {
    const inst = await createTestInstitution("mastery-ivn-guardian-student");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture);

      for (const role of ["guardian", "student"] as const) {
        const { data, error } = await inst.clientAs(role).from("insight_actions").select("id").eq("id", plan.actionId);
        expect(error).toBeNull();
        expect(data).toHaveLength(0);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("principal inserting a kind = 'intervention' row fails with 42501", async () => {
    const inst = await createTestInstitution("mastery-ivn-insert-denied");
    try {
      const fx = await buildMasteryFixture(inst);
      const base = await insertGapPlan(inst, fx, fx.students.fixture);

      const { error } = await inst
        .clientAs("principal")
        .from("insight_actions")
        .insert({
          institution_id: inst.institutionId,
          insight_id: base.insightId,
          action: "Intervention plan",
          owner: "Someone",
          rationale: "r",
          expected_outcome: "o",
          status: "planned",
          kind: "intervention",
          student_id: fx.students.a2,
          goal: "Raise 1 gap unit to 60% mastery",
          steps: [{ title: "Re-teach", due: "2026-12-01", done: false }],
          review_date: "2026-12-08",
          intervention_status: "proposed",
        });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("42501");
    } finally {
      await inst.cleanup();
    }
  });

  it("flipping an M19 action row to kind = 'intervention' is forbidden", async () => {
    const inst = await createTestInstitution("mastery-ivn-kind-flip");
    try {
      const plainAction = await insertPlainAction(inst);
      await expect(
        sql`update public.insight_actions set kind = 'intervention' where id = ${plainAction.actionId}`,
      ).rejects.toThrow(/code:forbidden/);
    } finally {
      await inst.cleanup();
    }
  });

  it("proposed -> review is an invalid transition", async () => {
    const inst = await createTestInstitution("mastery-ivn-bad-edge");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");

      const { error } = await inst
        .clientAs("teacher")
        .from("insight_actions")
        .update({ intervention_status: "review" })
        .eq("id", plan.actionId);
      expect(error?.message).toMatch(/code:invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("any update of a closed plan is invalid_state", async () => {
    const inst = await createTestInstitution("mastery-ivn-closed");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "closed");

      const { error } = await inst
        .clientAs("teacher")
        .from("insight_actions")
        .update({ goal: "New goal for the plan" })
        .eq("id", plan.actionId);
      expect(error?.message).toMatch(/code:invalid_state/);
    } finally {
      await inst.cleanup();
    }
  });

  it("closing sets the M19 status column to its terminal value", async () => {
    const inst = await createTestInstitution("mastery-ivn-close-sync");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "active");

      const { data, error } = await inst
        .clientAs("teacher")
        .from("insight_actions")
        .update({ intervention_status: "closed" })
        .eq("id", plan.actionId)
        .select("intervention_status, status");
      expect(error).toBeNull();
      expect(data?.[0]).toEqual({ intervention_status: "closed", status: "done" });
    } finally {
      await inst.cleanup();
    }
  });

  it("malformed steps are rejected as validation_failed", async () => {
    const inst = await createTestInstitution("mastery-ivn-bad-steps");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");

      const { error } = await inst
        .clientAs("teacher")
        .from("insight_actions")
        .update({ steps: [{ title: "", due: "not-a-date", done: "no" }] })
        .eq("id", plan.actionId);
      expect(error?.message).toMatch(/code:validation_failed/);
    } finally {
      await inst.cleanup();
    }
  });

  it("changing student_id is forbidden", async () => {
    const inst = await createTestInstitution("mastery-ivn-student-change");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture, "proposed");

      const { error } = await inst
        .clientAs("teacher")
        .from("insight_actions")
        .update({ student_id: fx.students.a2 })
        .eq("id", plan.actionId);
      expect(error?.message).toMatch(/code:forbidden/);
    } finally {
      await inst.cleanup();
    }
  });

  it("principal delete removes 0 rows", async () => {
    const inst = await createTestInstitution("mastery-ivn-delete-denied");
    try {
      const fx = await buildMasteryFixture(inst);
      const plan = await insertGapPlan(inst, fx, fx.students.fixture);

      const { error, data } = await inst
        .clientAs("principal")
        .from("insight_actions")
        .delete()
        .eq("id", plan.actionId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);

      const [row] = await sql`select id from public.insight_actions where id = ${plan.actionId}`;
      expect(row).toBeDefined();
    } finally {
      await inst.cleanup();
    }
  });
});
