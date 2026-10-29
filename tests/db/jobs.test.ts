import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { closeRolesHelper, createTestInstitution, withTwoInstitutions } from "../helpers/roles";

// C-70/C-71/C-72 already prove `app.claim_job`/`app.complete_job` themselves
// in tests/db/platform.test.ts (0003's own suite). This file proves the
// T-037 *runner* built on top of them: claim/dispatch/backoff wiring,
// unknown-type dead-lettering, and the stale-`running` reclaim, all against
// the real `public.jobs_claim`/`public.jobs_complete` wrappers
// (20261028000012) via the service-role client — no direct Postgres
// connection in the runner itself (lead rework: the web route must use the
// service role, never a superuser DSN). `sql` here is test-only fixture
// setup/teardown, the same as every other tests/db file.
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

afterEach(async () => {
  await sql`delete from public.jobs where idempotency_key like 'jobs-runner-test-%'`;
});

describe("jobs runner (T-037) against the real public.jobs_claim/public.jobs_complete wrappers", () => {
  it("C-70: two concurrent runOnce calls never both claim the same single job", async () => {
    const key = "jobs-runner-test-c70";
    await sql`select app.enqueue_job(null, 'notify.attendance_absence', '{}'::jsonb, ${key})`;

    const [summaryA, summaryB] = await Promise.all([
      runOnceCore({ workerId: "test-worker-a" }, createRunnerPorts(admin)),
      runOnceCore({ workerId: "test-worker-b" }, createRunnerPorts(admin)),
    ]);

    expect(summaryA.claimed + summaryB.claimed).toBe(1);
  });

  it("C-71: a handler that fails is requeued with backoff, then dies at max_attempts", async () => {
    const key = "jobs-runner-test-c71";
    const [job] = await sql`
      insert into public.jobs (type, payload, idempotency_key, max_attempts)
      values ('notify.attendance_absence', '{}'::jsonb, ${key}, 2)
      returning id
    `;
    const ports = createRunnerPorts(admin);

    const beforeFirst = Date.now();
    const first = await runOnceCore({ workerId: "test-worker-c71" }, ports);
    expect(first).toMatchObject({ claimed: 1, succeeded: 0, requeued: 1, dead: 0 });

    const [afterFirst] = await sql`select status, attempts, run_after from public.jobs where id = ${job.id}::uuid`;
    expect(afterFirst.status).toBe("queued");
    expect(afterFirst.attempts).toBe(1);
    expect(new Date(afterFirst.run_after).getTime()).toBeGreaterThan(beforeFirst);

    // Skip the real 2-minute backoff instead of waiting it out.
    await sql`update public.jobs set run_after = now() where id = ${job.id}::uuid`;

    const second = await runOnceCore({ workerId: "test-worker-c71" }, ports);
    expect(second).toMatchObject({ claimed: 1, succeeded: 0, requeued: 0, dead: 1 });

    const [afterSecond] = await sql`select status from public.jobs where id = ${job.id}::uuid`;
    expect(afterSecond.status).toBe("dead");
  });

  it("C-72: enqueuing the same idempotency key twice yields one job, claimed once by runOnce", async () => {
    const key = "jobs-runner-test-c72";
    await sql`select app.enqueue_job(null, 'notify.attendance_absence', '{}'::jsonb, ${key})`;
    await sql`select app.enqueue_job(null, 'notify.attendance_absence', '{}'::jsonb, ${key})`;

    const rows = await sql`select id from public.jobs where idempotency_key = ${key}`;
    expect(rows).toHaveLength(1);

    const summary = await runOnceCore({ workerId: "test-worker-c72" }, createRunnerPorts(admin));
    expect(summary.claimed).toBe(1);

    // Still exactly one row for this key — no duplicate was ever created,
    // and the handler's failure (a T-038 placeholder) just requeued it.
    const remaining = await sql`select id, attempts from public.jobs where idempotency_key = ${key}`;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].attempts).toBe(1);
  });

  it("dead-letters an unknown job type immediately, with no retry", async () => {
    const key = "jobs-runner-test-unknown";
    const [job] = await sql`
      insert into public.jobs (type, payload, idempotency_key)
      values ('totally.unregistered.type', '{}'::jsonb, ${key})
      returning id
    `;

    const summary = await runOnceCore({ workerId: "test-worker-unknown" }, createRunnerPorts(admin));
    expect(summary).toMatchObject({ claimed: 1, succeeded: 0, requeued: 0, dead: 1 });

    const [row] = await sql`select status, last_error, attempts from public.jobs where id = ${job.id}::uuid`;
    expect(row.status).toBe("dead");
    expect(row.last_error).toBe("unknown_type");
    // claim_job incremented attempts exactly once; killUnknown never retries.
    expect(row.attempts).toBe(1);
  });

  it("stale reclaim: a job stuck 'running' for >10 minutes is reclaimed and processed again", async () => {
    const key = "jobs-runner-test-stale";
    const [job] = await sql`
      insert into public.jobs (type, payload, idempotency_key, status, attempts, locked_at, locked_by)
      values ('notify.attendance_absence', '{}'::jsonb, ${key}, 'running', 1, now() - interval '15 minutes', 'dead-worker')
      returning id
    `;

    const summary = await runOnceCore({ workerId: "test-worker-stale" }, createRunnerPorts(admin));
    expect(summary.claimed).toBe(1);

    const [row] = await sql`select locked_by from public.jobs where id = ${job.id}::uuid`;
    expect(row.locked_by).not.toBe("dead-worker");
  });

  it("anon and authenticated cannot execute jobs_claim/jobs_complete (execute granted to service_role only)", async () => {
    const [{ can_execute: anonCanClaim }] = await sql`
      select has_function_privilege('anon', 'public.jobs_claim(text)', 'execute') as can_execute
    `;
    const [{ can_execute: authCanClaim }] = await sql`
      select has_function_privilege('authenticated', 'public.jobs_claim(text)', 'execute') as can_execute
    `;
    const [{ can_execute: anonCanComplete }] = await sql`
      select has_function_privilege('anon', 'public.jobs_complete(uuid, boolean, text)', 'execute') as can_execute
    `;
    const [{ can_execute: authCanComplete }] = await sql`
      select has_function_privilege('authenticated', 'public.jobs_complete(uuid, boolean, text)', 'execute') as can_execute
    `;

    expect(anonCanClaim).toBe(false);
    expect(authCanClaim).toBe(false);
    expect(anonCanComplete).toBe(false);
    expect(authCanComplete).toBe(false);
  });
});

describe("jobs_requeue (T-037 security review, HIGH — replaces the dropped jobs_update RLS policy)", () => {
  it("an authenticated admin's direct `update public.jobs` is permission denied", async () => {
    const inst = await createTestInstitution("jobs-requeue-direct-update");
    try {
      const [job] = await sql`
        insert into public.jobs (institution_id, type, payload, idempotency_key, status)
        values (${inst.institutionId}, 'notify.attendance_absence', '{}'::jsonb, 'jobs-requeue-direct-update', 'dead')
        returning id
      `;

      const result = await inst
        .clientAs("admin")
        .from("jobs")
        .update({ status: "queued" })
        .eq("id", job.id);

      expect(result.error).not.toBeNull();
      expect(result.error?.message ?? "").toMatch(/permission denied/i);
    } finally {
      await sql`delete from public.jobs where idempotency_key = 'jobs-requeue-direct-update'`;
      await inst.cleanup();
    }
  });

  it("requeue via rpc works for an admin of the same institution, and audits status+attempts only", async () => {
    const inst = await createTestInstitution("jobs-requeue-ok");
    try {
      const [job] = await sql`
        insert into public.jobs (institution_id, type, payload, idempotency_key, status, attempts, last_error)
        values (${inst.institutionId}, 'notify.attendance_absence', '{"secret":"x"}'::jsonb, 'jobs-requeue-ok', 'dead', 3, 'boom')
        returning id
      `;

      const { data, error } = await inst
        .clientAs("admin")
        .rpc("jobs_requeue", { p_institution_id: inst.institutionId, p_id: job.id });

      expect(error).toBeNull();
      expect(data?.status).toBe("queued");
      expect(data?.attempts).toBe(0);
      expect(data?.last_error).toBeNull();

      const auditRows = await sql`
        select before, after from public.audit_events
        where institution_id = ${inst.institutionId}::uuid and action = 'job.requeue' and entity_id = ${job.id}::uuid
      `;
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].before).toEqual({ status: "dead", attempts: 3 });
      expect(auditRows[0].after).toEqual({ status: "queued", attempts: 0 });
      expect(auditRows[0].before).not.toHaveProperty("payload");
      expect(auditRows[0].before).not.toHaveProperty("last_error");
    } finally {
      await sql`delete from public.jobs where idempotency_key = 'jobs-requeue-ok'`;
      await inst.cleanup();
    }
  });

  it("requeue is rejected for an admin of another institution, and for a teacher of the owning institution", async () => {
    await withTwoInstitutions(async (a, b) => {
      const [job] = await sql`
        insert into public.jobs (institution_id, type, payload, idempotency_key, status)
        values (${a.institutionId}, 'notify.attendance_absence', '{}'::jsonb, 'jobs-requeue-cross-inst', 'dead')
        returning id
      `;
      try {
        const crossInstResult = await b
          .clientAs("admin")
          .rpc("jobs_requeue", { p_institution_id: a.institutionId, p_id: job.id });
        expect(crossInstResult.error?.message).toBe("code:forbidden");

        const teacherResult = await a
          .clientAs("teacher")
          .rpc("jobs_requeue", { p_institution_id: a.institutionId, p_id: job.id });
        expect(teacherResult.error?.message).toBe("code:forbidden");

        const [stillDead] = await sql`select status from public.jobs where id = ${job.id}::uuid`;
        expect(stillDead.status).toBe("dead");
      } finally {
        await sql`delete from public.jobs where idempotency_key = 'jobs-requeue-cross-inst'`;
      }
    });
  });

  it("requeuing a non-dead job is rejected with invalid_state", async () => {
    const inst = await createTestInstitution("jobs-requeue-not-dead");
    try {
      const [job] = await sql`
        insert into public.jobs (institution_id, type, payload, idempotency_key, status)
        values (${inst.institutionId}, 'notify.attendance_absence', '{}'::jsonb, 'jobs-requeue-not-dead', 'queued')
        returning id
      `;

      const { error } = await inst
        .clientAs("admin")
        .rpc("jobs_requeue", { p_institution_id: inst.institutionId, p_id: job.id });

      expect(error?.message).toBe("code:invalid_state");
    } finally {
      await sql`delete from public.jobs where idempotency_key = 'jobs-requeue-not-dead'`;
      await inst.cleanup();
    }
  });

  it("requeuing a job that does not exist for the institution is rejected with not_found", async () => {
    const inst = await createTestInstitution("jobs-requeue-missing");
    try {
      const { error } = await inst
        .clientAs("admin")
        .rpc("jobs_requeue", { p_institution_id: inst.institutionId, p_id: crypto.randomUUID() });

      expect(error?.message).toBe("code:not_found");
    } finally {
      await inst.cleanup();
    }
  });
});
