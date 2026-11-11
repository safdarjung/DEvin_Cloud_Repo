// Features-18 #21 follow-up — a safety alert is delivered in-app inside the
// send request (claim → run → complete on its own notify.safety_alert job);
// the job runner stays the retry path. No scheduler is assumed.
import postgres from "postgres";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const failNotify = vi.hoisted(() => ({ on: false }));

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
// The handler's only send call; flipped on to force the in-request run to throw.
vi.mock("@/modules/notifications/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/notifications/service")>();
  return {
    ...actual,
    createNotification: ((...args: Parameters<typeof actual.createNotification>) =>
      failNotify.on ? Promise.reject(new Error("forced notify failure")) : actual.createNotification(...args)) as typeof actual.createNotification,
  };
});

import type { Database } from "@/lib/db/types";
import { sendSafetyAlert } from "@/modules/safety/actions";
import { safetyAlertDelivery } from "@/modules/safety/queries";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";
import { withoutSweeps } from "../helpers/runner-ports";
import { setActingClient } from "../helpers/server-client-mock";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });
let inst: TestInstitution;

const STAFF: FixtureRole[] = ["owner", "principal", "admin", "admissions", "accountant", "exam_controller", "teacher"];

beforeAll(async () => {
  inst = await createTestInstitution("safety-dlv");
});

afterAll(async () => {
  await sql`update public.safety_alerts set status = 'closed', closed_at = now(), closed_by = ${inst.users.principal.id}
    where institution_id = ${inst.institutionId} and status = 'active'`;
  await inst.cleanup();
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function recipientsOf(alertId: string): Promise<string[]> {
  const rows = await sql`select recipient_user_id from public.notifications
    where type = 'safety_alert' and data->>'key' like ${`safety_alert:${alertId}:%`} order by recipient_user_id`;
  return rows.map((r) => r.recipient_user_id as string);
}

async function jobOf(alertId: string) {
  const [job] = await sql`select status, attempts, locked_by, last_error from public.jobs where idempotency_key = ${`safety_alert:${alertId}`}`;
  return job!;
}

// A real runner pass (the scheduled path), sweeps off so seed data is untouched.
const runnerPass = () => runOnceCore({ workerId: "test-worker-safety-delivery", max: 500 }, withoutSweeps(createRunnerPorts(admin)));

async function deliveryAs(role: FixtureRole, alertId: string) {
  const ctx = await buildContext(inst, role);
  setActingClient(inst.clientAs(role) as unknown as SupabaseClient<Database>);
  try {
    return await safetyAlertDelivery(ctx, alertId);
  } finally {
    setActingClient(null);
  }
}

const staffIds = () => STAFF.map((r) => inst.users[r].id).sort();

describe("in-request safety alert delivery", () => {
  it("sending creates in-app notifications before any runner call; the job is completed and a later runner pass sends nothing new", async () => {
    const res = await callAs(inst, "admin", sendSafetyAlert, { kind: "emergency", title: "Lockdown", message: "Stay in class.", audience: "staff" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delivery).toBe("sent");

    expect(await recipientsOf(res.data.id)).toEqual(staffIds());
    expect(await jobOf(res.data.id)).toMatchObject({ status: "succeeded", locked_by: expect.any(String), last_error: null });

    await runnerPass();
    expect(await recipientsOf(res.data.id)).toEqual(staffIds());
    expect((await jobOf(res.data.id)).status).toBe("succeeded");

    // Managers see delivery state; the jobs table stays closed to other staff.
    expect(await deliveryAs("principal", res.data.id)).toBe("sent");
    expect(await deliveryAs("teacher", res.data.id)).toBeNull();
  });

  it("when the handler throws, the alert is saved, the action says queued, and a later runner pass delivers once", async () => {
    const message = "Gas leak near the lab: leave by the west gate.";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    failNotify.on = true;
    const res = await callAs(inst, "admin", sendSafetyAlert, { kind: "emergency", title: "Evacuate", message, audience: "staff" }).finally(() => {
      failNotify.on = false;
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.delivery).toBe("queued");

    const [alert] = await sql`select status, message from public.safety_alerts where id = ${res.data.id}`;
    expect(alert).toMatchObject({ status: "active", message });
    expect(await recipientsOf(res.data.id)).toEqual([]);
    // Back on the queue at once (no backoff, no attempt used), error recorded for the Jobs page.
    expect(await jobOf(res.data.id)).toMatchObject({ status: "queued", attempts: 0, locked_by: null, last_error: expect.any(String) });
    expect(await deliveryAs("admin", res.data.id)).toBe("queued");

    // Logged server-side, never with the alert's text.
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(message);
    errorSpy.mockRestore();

    await runnerPass();
    expect(await recipientsOf(res.data.id)).toEqual(staffIds());
    expect((await jobOf(res.data.id)).status).toBe("succeeded");

    await runnerPass();
    const [{ n }] = await sql`select count(*)::int as n from public.notifications where data->>'key' like ${`safety_alert:${res.data.id}:%`}`;
    expect(n).toBe(STAFF.length);
  });
});
