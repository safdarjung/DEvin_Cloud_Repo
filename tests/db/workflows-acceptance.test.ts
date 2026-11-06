// M23-T21 — workflow acceptance over HTTP: principal saves an event
// workflow (absence -> condition -> notify -> approval -> agent -> end),
// a teacher's submitted session with one absence drives it through the
// real job runner to `awaiting_approval`, principal's decision resumes it
// to `done` and queues an agent run, disabling the workflow stops new
// runs, and a schedule workflow fires once per due window (mirrors
// tests/db/timetable-acceptance.test.ts's HTTP dispatch helpers and
// tests/db/reports-acceptance.test.ts's forced-due + real-runner pattern).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { allModulesOn } from "@/lib/modules/catalog";
import { DEFAULT_INSTITUTION_SETTINGS } from "@/modules/core/schemas";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import {
  closeFactoriesHelper,
  createAcademicYear,
  createClassSection,
  createEnrolment,
  createGrade,
} from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

function actionRequest(name: string, body: unknown, headers: Record<string, string>): Request {
  return new Request(`http://localhost/api/v1/actions/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function dispatchAction(name: string, body: unknown, headers: Record<string, string>): Promise<Response> {
  return actionsPost(actionRequest(name, body, headers), { params: Promise.resolve({ name }) });
}

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

async function tokenFor(inst: TestInstitution, role: FixtureRole): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

/** 20:00 IST = 14:30 UTC same calendar day (no DST in India). */
function nextTwentyHundredIst(after: Date): Date {
  const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(after);
  const [y, m, d] = istDate.split("-").map(Number);
  let candidate = new Date(Date.UTC(y, m - 1, d, 14, 30, 0));
  if (candidate <= after) candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  return candidate;
}

function todayInTimezone(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
}

const ABSENCE_WORKFLOW_NODES = [
  { id: "t", type: "trigger", label: "Absence submitted", config: { kind: "event", event: "attendance.absences_submitted" } },
  { id: "c", type: "condition", label: "Absent today?", config: { metric: "attendance.session_absences", op: "gte", value: "1" } },
  { id: "n", type: "notify", label: "Notify principal", config: { audience: "roles", roles: "principal", message: "{count} absent today" } },
  { id: "a", type: "approval", label: "Start follow-up?", config: { prompt: "Have the attendance agent follow up on today's absences?" } },
  { id: "g", type: "agent", label: "Agent follow-up", config: { agent: "attendance", task: "Review today's absences and draft a follow-up note." } },
  { id: "e", type: "end", label: "End", config: {} },
  { id: "e2", type: "end", label: "End", config: {} },
  { id: "e3", type: "end", label: "End", config: {} },
];
const ABSENCE_WORKFLOW_EDGES = [
  { source: "t", target: "c" },
  { source: "c", target: "n", label: "true" },
  { source: "c", target: "e2", label: "false" },
  { source: "n", target: "a" },
  { source: "a", target: "g", label: "approved" },
  { source: "a", target: "e3", label: "rejected" },
  { source: "g", target: "e" },
];

const SCHEDULE_WORKFLOW_NODES = [
  { id: "t", type: "trigger", label: "Schedule", config: { kind: "schedule", cron: "0 20 * * *" } },
  { id: "c", type: "condition", label: "Overdue invoices?", config: { metric: "finance.overdue_invoices", op: "gte", value: "0" } },
  { id: "n", type: "notify", label: "Notify accountant", config: { audience: "roles", roles: "accountant", message: "{count} invoice(s) overdue" } },
  { id: "e", type: "end", label: "End", config: {} },
  { id: "e2", type: "end", label: "End", config: {} },
];
const SCHEDULE_WORKFLOW_EDGES = [
  { source: "t", target: "c" },
  { source: "c", target: "n", label: "true" },
  { source: "c", target: "e2", label: "false" },
  { source: "n", target: "e" },
];

describe("M23 workflow acceptance: event workflow through the runner, approval, disable, and a schedule workflow", () => {
  it(
    "principal saves+activates an event workflow; a teacher's absence drives it to awaiting_approval; admin is " +
      "refused the decision, principal approves it to done with a queued agent run; disabling stops new runs; a " +
      "schedule workflow fires once per due window",
    async () => {
      const inst = await createTestInstitution("workflows-acceptance");
      try {
        // Fixture institutions start with only `{ modules }` (tests/helpers/roles.ts);
        // attendance.mark's `.strict()` settings parse needs the full 05 §4.1 shape.
        await sql`
          update public.institutions
          set settings = ${sql.json({ modules: allModulesOn(), ...DEFAULT_INSTITUTION_SETTINGS })}::jsonb
          where id = ${inst.institutionId}::uuid
        `;

        const yearId = await createAcademicYear(inst.institutionId, { isCurrent: true });
        const gradeId = await createGrade(inst.institutionId, { code: "WA", displayName: "Grade WA", sortKey: 1 });

        const [{ staff_id: teacherStaffId }] = await sql<{ staff_id: string }[]>`
          select staff_id from public.memberships
          where institution_id = ${inst.institutionId} and user_id = ${inst.users.teacher.id}
        `;
        const sectionId = await createClassSection(inst.institutionId, gradeId, yearId, {
          name: "WA1",
          classTeacherId: teacherStaffId,
        });

        const [{ student_id: studentId }] = await sql<{ student_id: string }[]>`
          select student_id from public.memberships
          where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
        `;
        await createEnrolment(inst.institutionId, studentId, sectionId, yearId);

        const principalAuth = { authorization: `Bearer ${await tokenFor(inst, "principal")}` };
        const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
        const teacherAuth = { authorization: `Bearer ${await tokenFor(inst, "teacher")}` };

        // --- 1. principal saves the event workflow, then activates it --------
        const saveRes = await dispatchAction(
          "workflow.save",
          { institution: inst.slug, input: { name: "Absence follow-up", nodes: ABSENCE_WORKFLOW_NODES, edges: ABSENCE_WORKFLOW_EDGES } },
          principalAuth,
        );
        expect(saveRes.status).toBe(200);
        const saveBody = await saveRes.json();
        expect(saveBody.ok).toBe(true);
        expect(saveBody.data.status).toBe("draft");
        const workflowId = saveBody.data.id as string;

        const activateRes = await dispatchAction(
          "workflow.setStatus",
          { institution: inst.slug, input: { id: workflowId, status: "active" } },
          principalAuth,
        );
        expect(activateRes.status).toBe(200);
        const activateBody = await activateRes.json();
        expect(activateBody.ok).toBe(true);
        expect(activateBody.data.status).toBe("active");

        // --- 2. teacher marks and submits a session with 1 absent ------------
        const today = todayInTimezone("Asia/Kolkata");
        const markRes = await dispatchAction(
          "attendance.mark",
          { institution: inst.slug, input: { classSectionId: sectionId, date: today, records: [{ studentId, status: "A" }] } },
          teacherAuth,
        );
        expect(markRes.status).toBe(200);
        const markBody = await markRes.json();
        expect(markBody.ok).toBe(true);

        const submitRes = await dispatchAction(
          "attendance.submit",
          { institution: inst.slug, input: { sessionId: markBody.data.sessionId } },
          teacherAuth,
        );
        expect(submitRes.status).toBe(200);
        const submitBody = await submitRes.json();
        expect(submitBody.ok).toBe(true);

        // --- real runner: absence job -> workflow event -> run -> condition -> notify -> approval ---
        const ports = createRunnerPorts(admin);
        await runOnceCore({ workerId: "workflows-acceptance-worker" }, ports);
        await runOnceCore({ workerId: "workflows-acceptance-worker" }, ports);

        const runsRes = await dispatchQuery("workflows.runs", inst.slug, { workflowId }, principalAuth);
        expect(runsRes.status).toBe(200);
        const runsBody = await runsRes.json();
        expect(runsBody.ok).toBe(true);
        expect(runsBody.data).toHaveLength(1);
        expect(runsBody.data[0].status).toBe("awaiting_approval");
        const runId = runsBody.data[0].id as string;

        const [{ count: alertCount }] = await sql<{ count: string }[]>`
          select count(*) from public.notifications
          where institution_id = ${inst.institutionId}::uuid and type = 'workflow_alert'
            and recipient_user_id = ${inst.users.principal.id}::uuid
            and body = 'Absence follow-up: 1 absent today'
        `;
        expect(Number(alertCount)).toBe(1);

        const pendingRes = await dispatchQuery("core.approvals.pending", inst.slug, {}, principalAuth);
        expect(pendingRes.status).toBe(200);
        const pendingBody = await pendingRes.json();
        expect(pendingBody.ok).toBe(true);
        expect(pendingBody.data.some((row: { kind: string; id: string }) => row.kind === "workflow_run" && row.id === runId)).toBe(true);

        // --- 3. admin cannot decide; principal approves; runner resumes the run ---
        const adminDecideRes = await dispatchAction(
          "workflow.run.decide",
          { institution: inst.slug, input: { runId, decision: "approve" } },
          adminAuth,
        );
        expect(adminDecideRes.status).toBe(403);
        expect((await adminDecideRes.json()).error.code).toBe("forbidden");

        const approveRes = await dispatchAction(
          "workflow.run.decide",
          { institution: inst.slug, input: { runId, decision: "approve" } },
          principalAuth,
        );
        expect(approveRes.status).toBe(200);
        expect((await approveRes.json()).ok).toBe(true);

        await runOnceCore({ workerId: "workflows-acceptance-worker" }, ports);

        const runsAfterRes = await dispatchQuery("workflows.runs", inst.slug, { workflowId }, principalAuth);
        const runsAfterBody = await runsAfterRes.json();
        expect(runsAfterBody.data[0].status).toBe("done");

        const [{ count: agentRunCount }] = await sql<{ count: string }[]>`
          select count(*) from public.agent_runs where workflow_run_id = ${runId}::uuid and status = 'queued'
        `;
        expect(Number(agentRunCount)).toBe(1);

        const pendingAfterRes = await dispatchQuery("core.approvals.pending", inst.slug, {}, principalAuth);
        const pendingAfterBody = await pendingAfterRes.json();
        expect(
          pendingAfterBody.data.some((row: { kind: string; title: string }) => row.kind === "agent_run" && row.title.includes("waiting to start")),
        ).toBe(true);

        // --- 4. principal disables the workflow; another absence raises no new run ---
        const disableRes = await dispatchAction(
          "workflow.setStatus",
          { institution: inst.slug, input: { id: workflowId, status: "disabled" } },
          principalAuth,
        );
        expect(disableRes.status).toBe(200);

        // A different date (yesterday — attendance.mark refuses a future date) so
        // this is a distinct `attendance_sessions` row from step 2's.
        const yesterday = new Date(`${today}T00:00:00Z`);
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        const yesterdayDate = yesterday.toISOString().slice(0, 10);
        const markRes2 = await dispatchAction(
          "attendance.mark",
          { institution: inst.slug, input: { classSectionId: sectionId, date: yesterdayDate, records: [{ studentId, status: "A" }] } },
          teacherAuth,
        );
        expect(markRes2.status).toBe(200);
        const markBody2 = await markRes2.json();
        const submitRes2 = await dispatchAction(
          "attendance.submit",
          { institution: inst.slug, input: { sessionId: markBody2.data.sessionId } },
          teacherAuth,
        );
        expect(submitRes2.status).toBe(200);

        await runOnceCore({ workerId: "workflows-acceptance-worker" }, ports);
        await runOnceCore({ workerId: "workflows-acceptance-worker" }, ports);

        const runsStillRes = await dispatchQuery("workflows.runs", inst.slug, { workflowId }, principalAuth);
        const runsStillBody = await runsStillRes.json();
        expect(runsStillBody.data).toHaveLength(1); // still just the one run from step 2

        // --- 5. a schedule workflow fires once per due window -----------------
        const scheduleSaveRes = await dispatchAction(
          "workflow.save",
          { institution: inst.slug, input: { name: "Nightly overdue check", nodes: SCHEDULE_WORKFLOW_NODES, edges: SCHEDULE_WORKFLOW_EDGES } },
          principalAuth,
        );
        expect(scheduleSaveRes.status).toBe(200);
        const scheduleSaveBody = await scheduleSaveRes.json();
        const scheduleWorkflowId = scheduleSaveBody.data.id as string;

        const scheduleActivateRes = await dispatchAction(
          "workflow.setStatus",
          { institution: inst.slug, input: { id: scheduleWorkflowId, status: "active" } },
          principalAuth,
        );
        expect(scheduleActivateRes.status).toBe(200);

        await sql`
          update public.workflows set next_run_at = now() - interval '1 minute' where id = ${scheduleWorkflowId}::uuid
        `;

        const beforeSweep = new Date();
        await runOnceCore({ workerId: "workflows-acceptance-worker" }, ports);

        const scheduleRunsRes = await dispatchQuery("workflows.runs", inst.slug, { workflowId: scheduleWorkflowId }, principalAuth);
        const scheduleRunsBody = await scheduleRunsRes.json();
        expect(scheduleRunsBody.data).toHaveLength(1);
        expect(scheduleRunsBody.data[0].status).toBe("done");

        const [{ next_run_at: nextRunAt }] = await sql<{ next_run_at: string }[]>`
          select next_run_at from public.workflows where id = ${scheduleWorkflowId}::uuid
        `;
        expect(new Date(nextRunAt).getTime()).toBe(nextTwentyHundredIst(beforeSweep).getTime());

        await runOnceCore({ workerId: "workflows-acceptance-worker" }, ports);
        const scheduleRunsAgainRes = await dispatchQuery("workflows.runs", inst.slug, { workflowId: scheduleWorkflowId }, principalAuth);
        const scheduleRunsAgainBody = await scheduleRunsAgainRes.json();
        expect(scheduleRunsAgainBody.data).toHaveLength(1); // still just the one run

        // --- 6. teacher is refused workflows.list; admin can read it ----------
        const teacherListRes = await dispatchQuery("workflows.list", inst.slug, {}, teacherAuth);
        expect(teacherListRes.status).toBe(403);
        expect((await teacherListRes.json()).error.code).toBe("forbidden");

        const adminListRes = await dispatchQuery("workflows.list", inst.slug, {}, adminAuth);
        expect(adminListRes.status).toBe(200);
        expect((await adminListRes.json()).ok).toBe(true);
      } finally {
        await inst.cleanup();
      }
    },
  );
});
