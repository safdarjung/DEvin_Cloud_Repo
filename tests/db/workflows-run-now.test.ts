import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { runWorkflowNow, saveWorkflow, setWorkflowStatus } from "@/modules/workflows/actions";
import { buildGraph, type WorkflowForm } from "@/modules/workflows/form-graph";
import { callAs, closeActionsHelper } from "../helpers/actions";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createAttendanceRecord,
  createAttendanceSession,
  createClassSection,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// Workflow fixes: "Run now" executes the run inside the request (no cron),
// an empty workflow can never be activated or run, the per-section absent
// metric counts only that section's absences today, and agent steps accept
// the school's own (live) custom agents.
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const created: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((inst) => inst.cleanup()));
});

async function institution(label: string): Promise<TestInstitution> {
  const inst = await createTestInstitution(label);
  created.push(inst);
  await sql`
    update public.institutions
    set settings = settings || jsonb_build_object('attendance', jsonb_build_object('statuses', ${sql.json([
      { code: "P", label: "Present", counts_present: 1, in_denominator: true },
      { code: "A", label: "Absent", counts_present: 0, in_denominator: true, notify_guardian: true },
    ])}::jsonb))
    where id = ${inst.institutionId}::uuid
  `;
  return inst;
}

const todayIst = (): string => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

async function insertStudent(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.students (institution_id, admission_no, first_name, dob, gender)
    values (${institutionId}, ${`ADM-${crypto.randomUUID().slice(0, 8)}`}, 'Test Student', '2016-01-01', 'other')
    returning id
  `;
  return row.id as string;
}

/** A section with today's daily register: `absent` students marked A, `present` marked P. */
async function sectionWithRegister(inst: TestInstitution, yearId: string, gradeId: string, name: string, absent: number, present: number): Promise<string> {
  const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, { name });
  const sessionId = await createAttendanceSession(inst.institutionId, sectionId, { date: todayIst(), status: "submitted" });
  for (let i = 0; i < absent + present; i++) {
    await createAttendanceRecord(inst.institutionId, sessionId, await insertStudent(inst.institutionId), { status: i < absent ? "A" : "P" });
  }
  return sectionId;
}

const byHand = { label: "Run by hand", config: { kind: "manual" } };

function sectionCheck(sectionId: string): WorkflowForm {
  return {
    trigger: byHand,
    steps: [
      { type: "condition", label: "Absent today in X-A", config: { metric: "attendance.section_absent_today", op: "gte", value: "0", section: sectionId } },
      { type: "notify", label: "Tell the principal", config: { audience: "roles", roles: "principal", message: "{count} absent in X-A today." } },
    ],
  };
}

describe("workflow fixes: run now, empty workflows, section metric, custom agents", () => {
  it("an empty workflow saves only as a draft, and can never be activated or run", async () => {
    const inst = await institution("wf-empty");

    const saved = await callAs(inst, "principal", saveWorkflow, { name: "Nothing yet", ...buildGraph({ trigger: byHand, steps: [] }) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.data).toMatchObject({ status: "draft", steps: 0 });

    const activate = await callAs(inst, "principal", setWorkflowStatus, { id: saved.data.id, status: "active" });
    expect(activate.ok).toBe(false);
    if (activate.ok) return;
    expect(activate.error.code).toBe("validation_failed");
    expect(activate.error.fieldErrors?.steps).toBeDefined();

    // Even an empty workflow made active behind the action's back is never run.
    const { data: forced, error } = await admin
      .from("workflows")
      .insert({ institution_id: inst.institutionId, name: "Forced active", created_by: inst.users.principal.id, ...buildGraph({ trigger: byHand, steps: [] }), status: "active", trigger_type: "manual", trigger_config: "" })
      .select("id")
      .single();
    if (error || !forced) throw error ?? new Error("insert failed");
    const run = await callAs(inst, "principal", runWorkflowNow, { id: forced.id });
    expect(run.ok).toBe(false);
    if (run.ok) return;
    expect(run.error.code).toBe("validation_failed");
    const [{ count }] = await sql`select count(*)::int from public.workflow_runs where workflow_id = ${forced.id}::uuid`;
    expect(count).toBe(0);
  });

  it("run now executes in the request: a run row with each step's result, the section count, and a finished job", async () => {
    const inst = await institution("wf-run-now");
    const yearId = await createAcademicYear(inst.institutionId);
    const gradeId = await createGrade(inst.institutionId, { code: "X", displayName: "Class X", sortKey: 10 });
    const xa = await sectionWithRegister(inst, yearId, gradeId, "A", 2, 1);
    await sectionWithRegister(inst, yearId, gradeId, "B", 3, 0); // another section's absences never count

    const saved = await callAs(inst, "principal", saveWorkflow, { name: "Absent in X-A", ...buildGraph(sectionCheck(xa)) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect((await callAs(inst, "principal", setWorkflowStatus, { id: saved.data.id, status: "active" })).ok).toBe(true);

    const run = await callAs(inst, "principal", runWorkflowNow, { id: saved.data.id });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.data.status).toBe("done");
    expect(run.data.queued).toBe(false);
    expect(run.data.finishedAt).toBeTruthy();
    expect(run.data.steps.map((s) => [s.node_id, s.status])).toEqual([
      ["t", "done"],
      ["s1", "done"],
      ["s2", "done"],
      ["e", "done"],
    ]);
    expect(run.data.steps[1]!.note).toBe("Absent today in one section: 2 (is at least 0: yes)");

    const [row] = await sql`select status, last_value, steps from public.workflow_runs where id = ${run.data.runId}::uuid`;
    expect(row.status).toBe("done");
    expect(row.last_value).toBe(2);
    expect(row.steps).toEqual(run.data.steps);

    const [job] = await sql`select status from public.jobs where idempotency_key = ${`workflow.run:${run.data.runId}:start`}`;
    expect(job.status).toBe("succeeded");

    const [note] = await sql`
      select count(*)::int as n from public.notifications
      where institution_id = ${inst.institutionId}::uuid and type = 'workflow_alert'
    `;
    expect(note.n).toBeGreaterThan(0);
  });

  it("save rejects a section of another school, with the error on that step", async () => {
    const other = await institution("wf-section-other");
    const yearId = await createAcademicYear(other.institutionId);
    const gradeId = await createGrade(other.institutionId);
    const foreignSection = await createClassSection(other.institutionId, gradeId, yearId);

    const inst = await institution("wf-section-own");
    const saved = await callAs(inst, "principal", saveWorkflow, { name: "Foreign section", ...buildGraph(sectionCheck(foreignSection)) });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.error.code).toBe("validation_failed");
    expect(saved.error.fieldErrors?.["steps.0.section"]).toBeDefined();
  });

  it("agent steps take this school's live custom agents and queue a run for them", async () => {
    const inst = await institution("wf-custom-agent");
    const [custom] = await sql`
      insert into public.agent_definitions (institution_id, base_slug, name, summary, instructions, examples, tools, actions, created_by)
      values (${inst.institutionId}::uuid, 'attendance', 'Late-comer follow-up', 'Follows up late-comers.', 'Be brief.', '{}',
              array['attendance.attendanceTodaySummary'], '{}', ${inst.users.principal.id}::uuid)
      returning id, slug
    `;
    const form = (agent: string): WorkflowForm => ({
      trigger: byHand,
      steps: [{ type: "agent", label: "Follow up", config: { agent, task: "Summarise today's late-comers." } }],
    });

    const unknown = await callAs(inst, "principal", saveWorkflow, { name: "Unknown agent", ...buildGraph(form(`custom_${"c".repeat(32)}`)) });
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.error.fieldErrors?.["steps.0.agent"]).toBeDefined();

    const saved = await callAs(inst, "principal", saveWorkflow, { name: "Custom agent step", ...buildGraph(form(custom.slug)) });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect((await callAs(inst, "principal", setWorkflowStatus, { id: saved.data.id, status: "active" })).ok).toBe(true);
    const run = await callAs(inst, "principal", runWorkflowNow, { id: saved.data.id });
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.data.status).toBe("done");

    const agentRuns = await sql`select status from public.agent_runs where workflow_run_id = ${run.data.runId}::uuid and agent_id = ${custom.id}::uuid`;
    expect(agentRuns.map((r) => r.status)).toEqual(["queued"]);
  });
});
