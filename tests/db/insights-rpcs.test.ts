// M19-T3 — migration 0092 part 2: decide_insight, record_insight_action,
// set_insight_explanation (security definers) + review/visibility helpers.
// Real signed-in clients, same pattern as insights-rls.test.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createGrade,
  createSubjectAssignment,
  createSubject,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function adminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

const NOTE = "Looked into it, handled.";

interface InsightOverrides {
  signal?: string;
  domain?: string;
  reviewer_role?: string;
  approval_required?: boolean;
  status?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  class_section_id?: string | null;
}

async function insertInsight(institutionId: string, overrides: InsightOverrides = {}): Promise<string> {
  const { data, error } = await adminClient()
    .from("insights")
    .insert({
      institution_id: institutionId,
      signal: "finance.overdue_growth",
      detector_version: 1,
      dedupe_key: `dk-${crypto.randomUUID()}`,
      domain: "finance",
      kind: "descriptive",
      severity: "warning",
      title: "Overdue fees rising",
      pattern: "Overdue fees rose from 1,000 to 2,000 in the last 4 weeks.",
      evidence: [{ label: "Overdue now", value: 2000 }],
      date_from: "2026-09-01",
      date_to: "2026-10-01",
      confidence: 0.6,
      reviewer_role: "accountant",
      // distinct entity per row so insights_open_key never collides across tests
      entity_type: "fee_structure",
      entity_id: crypto.randomUUID(),
      ...overrides,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function insightRow(id: string) {
  const [row] = await sql`
    select status, reviewer_id, decided_by, decided_at, decision_note, explanation, explained_at, explained_by,
           explanation_provider, explanation_model
    from public.insights where id = ${id}
  `;
  return row;
}

function actionArgs(overrides: Record<string, unknown> = {}) {
  return {
    p_action: "Call the top 10 overdue families",
    p_owner: "Accounts office",
    p_rationale: "Most of the overdue balance sits with a few families.",
    p_expected_outcome: "Overdue balance drops by a third in two weeks.",
    ...overrides,
  };
}

describe("0092 part 2: decide_insight / record_insight_action / set_insight_explanation", () => {
  let inst: TestInstitution;
  let other: TestInstitution;
  let teacherSectionId: string;

  beforeAll(async () => {
    inst = await createTestInstitution("insights-rpcs");
    other = await createTestInstitution("insights-rpcs-other");
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId);
    teacherSectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name: "A" });
    const subjectId = await createSubject(inst.institutionId);
    const [teacherStaff] = await sql`
      select staff_id from public.memberships where institution_id = ${inst.institutionId} and role = 'teacher'
    `;
    await createSubjectAssignment(inst.institutionId, teacherSectionId, subjectId, teacherStaff.staff_id as string);
  }, 30_000);

  afterAll(async () => {
    await inst.cleanup();
    await other.cleanup();
  });

  describe("decide_insight", () => {
    it("principal: review -> reviewing with reviewer = self; audit holds {status} only", async () => {
      const id = await insertInsight(inst.institutionId);
      const { data, error } = await inst.clientAs("principal").rpc("decide_insight", { p_insight_id: id, p_action: "review" });
      expect(error).toBeNull();
      expect(data.status).toBe("reviewing");
      expect(data.reviewer_id).toBe(inst.users.principal.id);

      const audits = await sql`
        select action, before, after, metadata from public.audit_events
        where entity_type = 'insight' and entity_id = ${id}
      `;
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe("insight.reviewing");
      expect(audits[0].before).toEqual({ status: "new" });
      expect(audits[0].after).toEqual({ status: "reviewing" });
    });

    it("accountant reviews a finance insight; attendance insight -> forbidden", async () => {
      const finance = await insertInsight(inst.institutionId);
      const ok = await inst.clientAs("accountant").rpc("decide_insight", { p_insight_id: finance, p_action: "review" });
      expect(ok.error).toBeNull();
      expect(ok.data.reviewer_id).toBe(inst.users.accountant.id);

      // accountant cannot see attendance rows -> not_found (RLS visibility), not forbidden
      const attendance = await insertInsight(inst.institutionId, {
        signal: "attendance.section_drop",
        domain: "attendance",
        reviewer_role: "principal",
        entity_type: "section",
        entity_id: crypto.randomUUID(),
        class_section_id: teacherSectionId,
      });
      const hidden = await inst.clientAs("accountant").rpc("decide_insight", { p_insight_id: attendance, p_action: "review" });
      expect(hidden.error?.message).toContain("code:not_found");
    });

    it("teacher on a visible row -> forbidden; another institution's member -> not_found", async () => {
      const id = await insertInsight(inst.institutionId, {
        signal: "attendance.section_drop",
        domain: "attendance",
        reviewer_role: "principal",
        entity_type: "section",
        entity_id: crypto.randomUUID(),
        class_section_id: teacherSectionId,
      });
      const teacher = await inst.clientAs("teacher").rpc("decide_insight", { p_insight_id: id, p_action: "review" });
      expect(teacher.error?.message).toContain("code:forbidden");

      const stranger = await other.clientAs("principal").rpc("decide_insight", { p_insight_id: id, p_action: "review" });
      expect(stranger.error?.message).toContain("code:not_found");
    });

    it("review naming a teacher as reviewer -> validation_failed; unknown action -> validation_failed", async () => {
      const id = await insertInsight(inst.institutionId);
      const bad = await inst
        .clientAs("principal")
        .rpc("decide_insight", { p_insight_id: id, p_action: "review", p_reviewer_id: inst.users.teacher.id });
      expect(bad.error?.message).toContain("code:validation_failed");

      const unknown = await inst.clientAs("principal").rpc("decide_insight", { p_insight_id: id, p_action: "archive" });
      expect(unknown.error?.message).toContain("code:validation_failed");
    });

    it("reassigning a reviewing row needs owner/principal/admin", async () => {
      const id = await insertInsight(inst.institutionId);
      const first = await inst.clientAs("accountant").rpc("decide_insight", { p_insight_id: id, p_action: "review" });
      expect(first.error).toBeNull();

      // principal reassigns to admin -> ok
      const reassign = await inst
        .clientAs("principal")
        .rpc("decide_insight", { p_insight_id: id, p_action: "review", p_reviewer_id: inst.users.admin.id });
      expect(reassign.error).toBeNull();
      expect(reassign.data.reviewer_id).toBe(inst.users.admin.id);

      // accountant takes it back -> forbidden
      const grab = await inst.clientAs("accountant").rpc("decide_insight", { p_insight_id: id, p_action: "review" });
      expect(grab.error?.message).toContain("code:forbidden");
    });

    it("dismiss from actioned -> invalid_state; note shorter than 5 -> validation_failed", async () => {
      const actioned = await insertInsight(inst.institutionId, { status: "actioned" });
      const bad = await inst.clientAs("principal").rpc("decide_insight", { p_insight_id: actioned, p_action: "dismiss", p_note: NOTE });
      expect(bad.error?.message).toContain("code:invalid_state");

      const fresh = await insertInsight(inst.institutionId);
      const short = await inst.clientAs("principal").rpc("decide_insight", { p_insight_id: fresh, p_action: "dismiss", p_note: "nah" });
      expect(short.error?.message).toContain("code:validation_failed");

      const ok = await inst.clientAs("principal").rpc("decide_insight", { p_insight_id: fresh, p_action: "dismiss", p_note: NOTE });
      expect(ok.error).toBeNull();
      const row = await insightRow(fresh);
      expect(row.status).toBe("dismissed");
      expect(row.decided_by).toBe(inst.users.principal.id);
      expect(row.decision_note).toBe(NOTE);
      const audits = await sql`select action, before, after, metadata from public.audit_events where entity_id = ${fresh}`;
      expect(audits.map((a) => a.action)).toEqual(["insight.dismissed"]);
      expect(JSON.stringify(audits[0])).not.toContain(NOTE);
    });

    it("approval_required resolve: admin -> forbidden; principal -> ok", async () => {
      const id = await insertInsight(inst.institutionId, { approval_required: true });
      const admin = await inst.clientAs("admin").rpc("decide_insight", { p_insight_id: id, p_action: "resolve", p_note: NOTE });
      expect(admin.error?.message).toContain("code:forbidden");

      const principal = await inst.clientAs("principal").rpc("decide_insight", { p_insight_id: id, p_action: "resolve", p_note: NOTE });
      expect(principal.error).toBeNull();
      expect(principal.data.status).toBe("resolved");
      expect(principal.data.decided_at).not.toBeNull();
    });
  });

  describe("record_insight_action", () => {
    it("first action moves reviewing -> actioned; planned -> done -> measured by superseding; back/stale -> invalid_state", async () => {
      const id = await insertInsight(inst.institutionId);
      const principal = inst.clientAs("principal");
      await principal.rpc("decide_insight", { p_insight_id: id, p_action: "review" });

      const planned = await principal.rpc("record_insight_action", { p_insight_id: id, ...actionArgs() });
      expect(planned.error).toBeNull();
      expect(planned.data.status).toBe("planned");
      expect(planned.data.created_by).toBe(inst.users.principal.id);
      expect(planned.data.institution_id).toBe(inst.institutionId);
      expect((await insightRow(id)).status).toBe("actioned");

      const done = await principal.rpc("record_insight_action", {
        p_insight_id: id,
        ...actionArgs({ p_status: "done", p_supersedes_id: planned.data.id }),
      });
      expect(done.error).toBeNull();
      expect(done.data.supersedes_id).toBe(planned.data.id);

      // going back done -> planned
      const back = await principal.rpc("record_insight_action", {
        p_insight_id: id,
        ...actionArgs({ p_status: "planned", p_supersedes_id: done.data.id }),
      });
      expect(back.error?.message).toContain("code:invalid_state");

      // superseding an already superseded row
      const stale = await principal.rpc("record_insight_action", {
        p_insight_id: id,
        ...actionArgs({ p_status: "measured", p_actual_outcome: "Dropped by 40%.", p_supersedes_id: planned.data.id }),
      });
      expect(stale.error?.message).toContain("code:invalid_state");

      // measured without actual_outcome
      const noOutcome = await principal.rpc("record_insight_action", {
        p_insight_id: id,
        ...actionArgs({ p_status: "measured", p_supersedes_id: done.data.id }),
      });
      expect(noOutcome.error?.message).toContain("code:validation_failed");

      const measured = await principal.rpc("record_insight_action", {
        p_insight_id: id,
        ...actionArgs({ p_status: "measured", p_actual_outcome: "Dropped by 40%.", p_supersedes_id: done.data.id }),
      });
      expect(measured.error).toBeNull();
      expect(measured.data.measured_at).not.toBeNull();

      const audits = await sql`
        select action, before, after, metadata from public.audit_events
        where entity_type = 'insight' and entity_id = ${id} and action = 'insight.action_recorded'
      `;
      expect(audits).toHaveLength(3);
      expect(JSON.stringify(audits)).not.toContain("overdue families");
    });

    it("measured on a resolved insight -> ok; new action on a dismissed insight -> invalid_state", async () => {
      const principal = inst.clientAs("principal");
      const id = await insertInsight(inst.institutionId);
      const planned = await principal.rpc("record_insight_action", { p_insight_id: id, ...actionArgs() });
      expect(planned.error).toBeNull();
      const resolve = await principal.rpc("decide_insight", { p_insight_id: id, p_action: "resolve", p_note: NOTE });
      expect(resolve.error).toBeNull();

      const measured = await principal.rpc("record_insight_action", {
        p_insight_id: id,
        ...actionArgs({ p_status: "measured", p_actual_outcome: "Dropped by 40%.", p_supersedes_id: planned.data.id }),
      });
      expect(measured.error).toBeNull();
      expect((await insightRow(id)).status).toBe("resolved");

      const fresh = await principal.rpc("record_insight_action", { p_insight_id: id, ...actionArgs() });
      expect(fresh.error?.message).toContain("code:invalid_state");

      const dismissed = await insertInsight(inst.institutionId, { status: "dismissed" });
      const onDismissed = await principal.rpc("record_insight_action", { p_insight_id: dismissed, ...actionArgs() });
      expect(onDismissed.error?.message).toContain("code:invalid_state");
    });

    it("teacher (visible) -> forbidden; other institution -> not_found; text too long -> validation_failed", async () => {
      const id = await insertInsight(inst.institutionId, {
        signal: "academics.missing_work",
        domain: "academics",
        reviewer_role: "exam_controller",
        entity_type: "section",
        entity_id: crypto.randomUUID(),
        class_section_id: teacherSectionId,
      });
      const teacher = await inst.clientAs("teacher").rpc("record_insight_action", { p_insight_id: id, ...actionArgs() });
      expect(teacher.error?.message).toContain("code:forbidden");

      const stranger = await other.clientAs("principal").rpc("record_insight_action", { p_insight_id: id, ...actionArgs() });
      expect(stranger.error?.message).toContain("code:not_found");

      const long = await inst
        .clientAs("exam_controller")
        .rpc("record_insight_action", { p_insight_id: id, ...actionArgs({ p_owner: "x".repeat(81) }) });
      expect(long.error?.message).toContain("code:validation_failed");
    });
  });

  describe("set_insight_explanation", () => {
    const explanation = {
      what: "Overdue fees grew for four weeks.",
      why: "A few families hold most of the balance.",
      next_steps: ["Call the top families", "Offer a plan"],
    };

    it("writes only the five explanation columns; status unchanged; audit holds provider, no text", async () => {
      const id = await insertInsight(inst.institutionId);
      const { data, error } = await inst.clientAs("accountant").rpc("set_insight_explanation", {
        p_insight_id: id,
        p_explanation: explanation,
        p_provider: "local",
        p_model: "qwen2.5:7b",
      });
      expect(error).toBeNull();
      expect(data.status).toBe("new");
      const row = await insightRow(id);
      expect(row.explanation).toEqual(explanation);
      expect(row.explained_by).toBe(inst.users.accountant.id);
      expect(row.explained_at).not.toBeNull();
      expect(row.explanation_provider).toBe("local");
      expect(row.explanation_model).toBe("qwen2.5:7b");
      expect(row.reviewer_id).toBeNull();
      expect(row.decided_by).toBeNull();

      const audits = await sql`select action, before, after, metadata from public.audit_events where entity_id = ${id}`;
      expect(audits).toHaveLength(1);
      expect(audits[0].action).toBe("insight.explained");
      expect(audits[0].metadata).toEqual({ provider: "local" });
      expect(JSON.stringify(audits[0])).not.toContain("families");
    });

    it("next_steps with 4 items -> validation_failed; bad provider -> validation_failed; dismissed -> invalid_state; not visible -> not_found", async () => {
      const id = await insertInsight(inst.institutionId);
      const principal = inst.clientAs("principal");
      const four = await principal.rpc("set_insight_explanation", {
        p_insight_id: id,
        p_explanation: { ...explanation, next_steps: ["a", "b", "c", "d"] },
        p_provider: "local",
        p_model: "m",
      });
      expect(four.error?.message).toContain("code:validation_failed");

      const badProvider = await principal.rpc("set_insight_explanation", {
        p_insight_id: id,
        p_explanation: explanation,
        p_provider: "openai",
        p_model: "m",
      });
      expect(badProvider.error?.message).toContain("code:validation_failed");

      const dismissed = await insertInsight(inst.institutionId, { status: "dismissed" });
      const closed = await principal.rpc("set_insight_explanation", {
        p_insight_id: dismissed,
        p_explanation: explanation,
        p_provider: "cloud",
        p_model: "m",
      });
      expect(closed.error?.message).toContain("code:invalid_state");

      const hidden = await inst.clientAs("admissions").rpc("set_insight_explanation", {
        p_insight_id: id,
        p_explanation: explanation,
        p_provider: "cloud",
        p_model: "m",
      });
      expect(hidden.error?.message).toContain("code:not_found");
    });
  });

  it("app.* helpers are not callable by authenticated", async () => {
    const { error } = await inst.clientAs("principal").rpc("can_review_insight", { p_institution_id: inst.institutionId, p_domain: "finance" });
    expect(error).not.toBeNull();
  });
});
