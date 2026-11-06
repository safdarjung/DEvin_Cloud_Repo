// M23-T11 — engine ports against the real DB (service-role client), same
// shape as tests/db/agents-queue.test.ts and tests/db/report-generate-job.test.ts.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createEnginePorts } from "../../src/modules/workflows/ports.ts";
import { closeFactoriesHelper, createAcademicYear, createEnquiry, createTerm } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL as string, process.env.SUPABASE_SECRET_KEY as string);
}

const admin = serviceClient();
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
const NOW = () => new Date();

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

async function freshInstitution(name: string): Promise<TestInstitution> {
  const inst = await createTestInstitution(name);
  createdInstitutions.push(inst);
  return inst;
}

const MANUAL_NODES = [{ id: "t" }, { id: "e" }];
const MANUAL_EDGES = [{ source: "t", target: "e" }];

async function insertWorkflow(institutionId: string, createdBy: string): Promise<string> {
  const { data, error } = await admin
    .from("workflows")
    .insert({
      institution_id: institutionId,
      name: `Workflow ${crypto.randomUUID().slice(0, 8)}`,
      trigger_type: "manual",
      trigger_config: "",
      nodes: MANUAL_NODES,
      edges: MANUAL_EDGES,
      created_by: createdBy,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function insertRun(institutionId: string, workflowId: string, entityId: string | null = null): Promise<string> {
  const { data, error } = await admin
    .from("workflow_runs")
    .insert({
      institution_id: institutionId,
      workflow_id: workflowId,
      workflow_version: 1,
      graph: { nodes: MANUAL_NODES, edges: MANUAL_EDGES },
      trigger_kind: "manual",
      trigger_key: `manual:${crypto.randomUUID()}`,
      entity_id: entityId,
      status: "running",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id as string;
}

async function portsFor(inst: TestInstitution, workflowId: string, entityId: string | null = null) {
  const runId = await insertRun(inst.institutionId, workflowId, entityId);
  const run = { id: runId, institution_id: inst.institutionId, entity_id: entityId };
  const workflow = { name: "Test workflow", created_by: inst.users.principal.id };
  return { run, ports: createEnginePorts(admin as never, run, workflow, { modules: {} }, NOW) };
}

async function createSchedule(inst: TestInstitution, status: "active" | "paused" = "active"): Promise<string> {
  const { data, error } = await admin
    .from("scheduled_reports")
    .insert({
      institution_id: inst.institutionId,
      name: `Schedule ${crypto.randomUUID().slice(0, 8)}`,
      source: "attendance.daily",
      cron: "0 20 * * *",
      recipient_roles: ["principal"],
      status,
      created_by: inst.users.admin.id,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create schedule fixture");
  return data.id as string;
}

async function workflowAlertCount(institutionId: string): Promise<number> {
  const { count, error } = await admin
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", institutionId)
    .eq("type", "workflow_alert");
  if (error) throw error;
  return count ?? 0;
}

async function jobCountByType(institutionId: string, type: string): Promise<number> {
  const { count, error } = await admin
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", institutionId)
    .eq("type", type);
  if (error) throw error;
  return count ?? 0;
}

describe("createEnginePorts (M23-T11)", () => {
  it("metric: returns the SQL count, and wraps a failing rpc as metric_failed", async () => {
    const inst = await freshInstitution("ports-metric");
    const workflowId = await insertWorkflow(inst.institutionId, inst.users.principal.id);
    const { ports } = await portsFor(inst, workflowId);

    await createEnquiry(inst.institutionId, { status: "new" });
    await sql`update public.enquiries set created_at = now() - interval '3 days' where institution_id = ${inst.institutionId}`;

    await expect(ports.metric("admissions.stale_enquiries")).resolves.toBe(1);
    await expect(ports.metric("not.a.metric" as never)).rejects.toThrow("metric_failed");
  });

  it("notify roles: one workflow_alert per active member in the list, none for a disabled membership or a role outside it, idempotent on rerun", async () => {
    const inst = await freshInstitution("ports-notify-roles");
    const workflowId = await insertWorkflow(inst.institutionId, inst.users.principal.id);
    const { ports } = await portsFor(inst, workflowId);

    const first = await ports.notify({ audience: "roles", roles: ["principal", "admin"], message: "hi" }, "hi");
    expect(first).toEqual({ status: "done", note: "Notified 2" });
    expect(await workflowAlertCount(inst.institutionId)).toBe(2);

    // Rerun of the same node (same run id) is idempotent — no new rows.
    const second = await ports.notify({ audience: "roles", roles: ["principal", "admin"], message: "hi" }, "hi");
    expect(second).toEqual({ status: "done", note: "Notified 2" });
    expect(await workflowAlertCount(inst.institutionId)).toBe(2);

    // Teacher was never in the role list — never notified. Confirmed by
    // the count staying at 2 (one per principal+admin only).

    // A fresh run (own entity id → own idempotency key), with admin disabled.
    await admin.from("memberships").update({ status: "disabled" }).eq("institution_id", inst.institutionId).eq("role", "admin");
    const { ports: ports2 } = await portsFor(inst, workflowId);
    const third = await ports2.notify({ audience: "roles", roles: ["principal", "admin"], message: "hi" }, "hi");
    expect(third).toEqual({ status: "done", note: "Notified 1" });
  });

  it("notify roles: no active members in the list → skipped", async () => {
    const inst = await freshInstitution("ports-notify-empty");
    const workflowId = await insertWorkflow(inst.institutionId, inst.users.principal.id);
    const { ports } = await portsFor(inst, workflowId);

    await admin.from("memberships").update({ status: "disabled" }).eq("institution_id", inst.institutionId).eq("role", "accountant");
    await expect(ports.notify({ audience: "roles", roles: ["accountant"], message: "hi" }, "hi")).resolves.toEqual({
      status: "skipped",
      note: "No recipients",
    });
  });

  it("notify fee_defaulters: queues finance.fee_reminder for the current term, idempotent, skipped with no current term", async () => {
    const inst = await freshInstitution("ports-fee-defaulters");
    const workflowId = await insertWorkflow(inst.institutionId, inst.users.principal.id);
    const { ports } = await portsFor(inst, workflowId);

    await expect(ports.notify({ audience: "fee_defaulters" }, "")).resolves.toEqual({
      status: "skipped",
      note: "No current term",
    });

    const yearId = await createAcademicYear(inst.institutionId, { startsOn: "2026-10-01", endsOn: "2027-03-31" });
    await createTerm(inst.institutionId, yearId, { startsOn: "2026-10-01", endsOn: "2027-03-31" });

    const first = await ports.notify({ audience: "fee_defaulters" }, "");
    expect(first).toEqual({ status: "done", note: "Fee reminders queued" });
    expect(await jobCountByType(inst.institutionId, "finance.fee_reminder")).toBe(1);

    const second = await ports.notify({ audience: "fee_defaulters" }, "");
    expect(second).toEqual({ status: "done", note: "Fee reminders queued" });
    expect(await jobCountByType(inst.institutionId, "finance.fee_reminder")).toBe(1);
  });

  it("report: queues report.generate for an active schedule, skips a paused or cross-institution schedule id", async () => {
    const instA = await freshInstitution("ports-report-a");
    const instB = await freshInstitution("ports-report-b");
    const workflowId = await insertWorkflow(instA.institutionId, instA.users.principal.id);
    const { ports } = await portsFor(instA, workflowId);

    const activeId = await createSchedule(instA, "active");
    const pausedId = await createSchedule(instA, "paused");
    const otherId = await createSchedule(instB, "active");

    await expect(ports.report({ scheduledReportId: activeId })).resolves.toEqual({ status: "done", note: "Report queued" });
    expect(await jobCountByType(instA.institutionId, "report.generate")).toBe(1);

    await expect(ports.report({ scheduledReportId: pausedId })).resolves.toEqual({
      status: "skipped",
      note: "Report missing or paused",
    });
    await expect(ports.report({ scheduledReportId: otherId })).resolves.toEqual({
      status: "skipped",
      note: "Report missing or paused",
    });
  });

  it("agent: queues an agent run, skipped for a disabled agent definition", async () => {
    const inst = await freshInstitution("ports-agent");
    const workflowId = await insertWorkflow(inst.institutionId, inst.users.principal.id);

    const { run, ports } = await portsFor(inst, workflowId);
    const queued = await ports.agent({ agent: "finance", task: "Review overdue invoices" });
    expect(queued).toEqual({ status: "done", note: "Agent run queued" });
    const { count } = await admin
      .from("agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("workflow_run_id", run.id);
    expect(count).toBe(1);

    await admin.from("agent_definitions").update({ is_enabled: false }).eq("institution_id", inst.institutionId).eq("slug", "admissions");
    const { ports: ports2 } = await portsFor(inst, workflowId);
    await expect(ports2.agent({ agent: "admissions", task: "Follow up" })).resolves.toEqual({
      status: "skipped",
      note: "Agent turned off",
    });
  });
});
