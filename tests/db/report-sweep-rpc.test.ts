// M15-T5 — migration 0077 part 3: public.enqueue_due_reports() sweep
// (Scheduling, Idempotency rulings). "Due" is simulated by pushing
// next_run_at into the past via the raw `sql` connection (session_user =
// 'postgres', trusted by the write guard — 20261028000003_platform.sql
// `app.scheduled_reports_before_write`), never through the authenticated
// client (which cannot set next_run_at at all).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

async function insertSchedule(inst: TestInstitution, name: string): Promise<{ id: string; nextRunAt: string }> {
  const { data, error } = await inst
    .clientAs("admin")
    .from("scheduled_reports")
    .insert({
      institution_id: inst.institutionId,
      name,
      source: "attendance.daily",
      cron: "0 20 * * *",
      recipient_roles: ["principal"],
    })
    .select("id, next_run_at")
    .single();
  if (error || !data) throw error ?? new Error("insert failed");
  return { id: data.id as string, nextRunAt: data.next_run_at as string };
}

async function setNextRunAt(id: string, when: Date): Promise<void> {
  await sql`update public.scheduled_reports set next_run_at = ${when.toISOString()} where id = ${id}::uuid`;
}

async function jobsFor(scheduleId: string) {
  return sql`select * from public.jobs where type = 'report.generate' and payload ->> 'scheduled_report_id' = ${scheduleId}`;
}

describe("public.enqueue_due_reports (0077)", () => {
  it("one due active schedule enqueues exactly one job and advances next_run_at", async () => {
    const inst = await createTestInstitution("sweep-due");
    createdInstitutions.push(inst);

    const { id, nextRunAt } = await insertSchedule(inst, "Nightly attendance");
    const pastFire = new Date(Date.now() - 60_000);
    await setNextRunAt(id, pastFire);

    const { data: count, error } = await admin.rpc("enqueue_due_reports");
    expect(error).toBeNull();
    expect(count).toBe(1);

    const jobs = await jobsFor(id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.scheduled_report_id).toBe(id);
    expect(new Date(jobs[0].payload.fire_at as string).getTime()).toBe(pastFire.getTime());
    const stamp = pastFire
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z")
      .slice(0, 13) + "Z"; // YYYYMMDDTHHMM Z
    expect(jobs[0].idempotency_key).toBe(`report.generate:${id}:${stamp}`);

    const [row] = await sql`select next_run_at from public.scheduled_reports where id = ${id}::uuid`;
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(row.next_run_at).toISOString()).not.toBe(nextRunAt);
  });

  it("second call on the same institution enqueues nothing more", async () => {
    const inst = await createTestInstitution("sweep-twice");
    createdInstitutions.push(inst);

    const { id } = await insertSchedule(inst, "Nightly attendance");
    await setNextRunAt(id, new Date(Date.now() - 60_000));

    const first = await admin.rpc("enqueue_due_reports");
    expect(first.data).toBe(1);

    const second = await admin.rpc("enqueue_due_reports");
    expect(second.data).toBe(0);

    const jobs = await jobsFor(id);
    expect(jobs).toHaveLength(1);
  });

  it("paused schedule (next_run_at null) is not swept", async () => {
    const inst = await createTestInstitution("sweep-paused");
    createdInstitutions.push(inst);

    const { id } = await insertSchedule(inst, "Nightly attendance");
    const { error } = await inst.clientAs("admin").from("scheduled_reports").update({ status: "paused" }).eq("id", id);
    expect(error).toBeNull();

    const { data: count } = await admin.rpc("enqueue_due_reports");
    expect(count).toBe(0);
    expect(await jobsFor(id)).toHaveLength(0);
  });

  it("not yet due (default future next_run_at) is not swept", async () => {
    const inst = await createTestInstitution("sweep-not-due");
    createdInstitutions.push(inst);

    const { id } = await insertSchedule(inst, "Nightly attendance");

    const { data: count } = await admin.rpc("enqueue_due_reports");
    expect(count).toBe(0);
    expect(await jobsFor(id)).toHaveLength(0);
  });

  it("overdue by 3 days fires once, advancing next_run_at past now", async () => {
    const inst = await createTestInstitution("sweep-overdue");
    createdInstitutions.push(inst);

    const { id } = await insertSchedule(inst, "Nightly attendance");
    await setNextRunAt(id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000));

    const { data: count } = await admin.rpc("enqueue_due_reports");
    expect(count).toBe(1);
    expect(await jobsFor(id)).toHaveLength(1);

    const [row] = await sql`select next_run_at from public.scheduled_reports where id = ${id}::uuid`;
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("module off for the institution skips the row; back on sweeps it", async () => {
    const inst = await createTestInstitution("sweep-module-off");
    createdInstitutions.push(inst);

    const { id } = await insertSchedule(inst, "Nightly attendance");
    const pastFire = new Date(Date.now() - 60_000);
    await setNextRunAt(id, pastFire);

    await setModule(inst.institutionId, "scheduled_reports", false);
    const off = await admin.rpc("enqueue_due_reports");
    expect(off.data).toBe(0);
    expect(await jobsFor(id)).toHaveLength(0);
    const [unchanged] = await sql`select next_run_at from public.scheduled_reports where id = ${id}::uuid`;
    expect(new Date(unchanged.next_run_at).toISOString()).toBe(pastFire.toISOString());

    await setModule(inst.institutionId, "scheduled_reports", true);
    const on = await admin.rpc("enqueue_due_reports");
    expect(on.data).toBe(1);
    expect(await jobsFor(id)).toHaveLength(1);
  });

  it("an authenticated admin cannot call the sweep RPC directly (42501)", async () => {
    const inst = await createTestInstitution("sweep-perm");
    createdInstitutions.push(inst);

    const { error } = await inst.clientAs("admin").rpc("enqueue_due_reports");
    expect(error?.code).toBe("42501");
  });
});
