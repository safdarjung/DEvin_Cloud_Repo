// Curveball sweep (jobs): requeueJob at the action layer — happy path, roles, other school, state misuse, parallel requeue.
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { requeueJob } from "@/modules/jobs/actions";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 3 });
let a: TestInstitution;
let b: TestInstitution;
const keys: string[] = [];

async function job(inst: TestInstitution, status = "dead"): Promise<string> {
  const key = `jobs-cb-${crypto.randomUUID()}`;
  keys.push(key);
  const [row] = await sql`
    insert into public.jobs (institution_id, type, payload, idempotency_key, status, attempts, last_error, run_after)
    values (${inst.institutionId}, 'notify.attendance_absence', '{}'::jsonb, ${key}, ${status}, 3, 'boom', now() + interval '1 day')
    returning id
  `;
  return row.id as string;
}

beforeAll(async () => {
  a = await createTestInstitution("jobs-cb");
  b = await createTestInstitution("jobs-cb-x");
});

afterAll(async () => {
  await sql`delete from public.jobs where idempotency_key = any(${keys})`;
  await a?.cleanup();
  await b?.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

describe("requeueJob curveballs", () => {
  it("admin requeues a dead job through the action: queued, attempts reset", async () => {
    const id = await job(a);
    const r = await callAs(a, "admin", requeueJob, { jobId: id });
    expect(r.ok ? r.data.id : null).toBe(id);
    const [row] = await sql`select status, attempts from public.jobs where id = ${id}`;
    expect([row.status, row.attempts]).toEqual(["queued", 0]);
  });

  it("teacher, accountant and guardian → forbidden; job untouched", async () => {
    const id = await job(a);
    for (const role of ["teacher", "accountant", "guardian"] as const) {
      const r = await callAs(a, role, requeueJob, { jobId: id });
      expect(r.ok ? null : r.error.code).toBe("forbidden");
    }
    const [row] = await sql`select status from public.jobs where id = ${id}`;
    expect(row.status).toBe("dead");
  });

  it("another school's dead job → not_found and stays dead", async () => {
    const id = await job(b);
    const r = await callAs(a, "admin", requeueJob, { jobId: id });
    expect(r.ok ? null : r.error.code).toBe("not_found");
    const [row] = await sql`select status from public.jobs where id = ${id}`;
    expect(row.status).toBe("dead");
  });

  it("requeuing a queued or succeeded job → invalid_state; non-uuid → validation_failed on jobId", async () => {
    for (const status of ["queued", "succeeded"]) {
      const r = await callAs(a, "admin", requeueJob, { jobId: await job(a, status) });
      expect(r.ok ? null : r.error.code).toBe("invalid_state");
    }
    const bad = await callAs(a, "admin", requeueJob, { jobId: "42" });
    expect(bad.ok ? null : bad.error.fieldErrors?.jobId).toBeTruthy();
  });

  it("two parallel requeues of one dead job: exactly one succeeds, one audit row", async () => {
    const id = await job(a);
    const rs = await Promise.all([callAs(a, "admin", requeueJob, { jobId: id }), callAs(a, "owner", requeueJob, { jobId: id })]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    const audits = await sql`select 1 from public.audit_events where action = 'job.requeue' and entity_id = ${id}`;
    expect(audits).toHaveLength(1);
  });
});
