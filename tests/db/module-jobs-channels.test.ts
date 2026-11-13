import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

// Opt-in mocks (T-022 lead review pattern), same as tests/db/member-invite-actions.test.ts
// — only this file's module graph; every other db test still imports the real modules.
vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { inviteMember } from "@/modules/core/actions";
import { createNotification } from "@/modules/notifications/service";
import { createRunnerPorts } from "@/modules/jobs/runner";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { withoutSweeps } from "../helpers/runner-ports";

// MOD-T11 — JOB_MODULES gate in the runner's dispatch (src/modules/jobs/runner.ts),
// email/sms channel drop in notifications/service.ts, and inviteMember's email
// fallback, all against the real `app.module_enabled`-backed settings column
// (MOD-T12's migration already on this DB).
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setModule(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', ${key}], ${enabled}::text::jsonb)
    where id = ${institutionId}::uuid
  `;
}

async function publishRoleAnnouncement(inst: TestInstitution, role: string): Promise<string> {
  const { data: draft, error: draftError } = await inst
    .clientAs("admin")
    .from("announcements")
    .insert({ institution_id: inst.institutionId, title: "Notice", body: "Body text.", created_by: inst.users.admin.id })
    .select("id")
    .single();
  if (draftError || !draft) throw draftError ?? new Error("draft insert failed");

  const { error: audienceError } = await inst.clientAs("admin").from("announcement_audiences").insert({
    announcement_id: draft.id,
    institution_id: inst.institutionId,
    audience_type: "role",
    role,
  });
  if (audienceError) throw audienceError;

  const { error: publishError } = await inst.clientAs("admin").rpc("publish_announcement", { p_announcement_id: draft.id });
  if (publishError) throw publishError;

  return draft.id as string;
}

async function createUnlinkedStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Unlinked Staff', 'Teacher')
    returning id
  `;
  return row.id as string;
}

// The queue is shared with every other test and the dev server: claim until this
// institution's job comes up, and put anyone else's back untouched.
async function claimOwnJob(ports: ReturnType<typeof createRunnerPorts>, institutionId: string) {
  const skipped: { id: string; runAfter: string }[] = [];
  try {
    for (let i = 0; i < 500; i += 1) {
      const job = await ports.claimJob(`mod-t11-${crypto.randomUUID()}`);
      if (!job || job.institution_id === institutionId) return job;
      // Park it in the future so the next claim moves on; restored below.
      skipped.push({ id: job.id, runAfter: job.run_after });
      await sql`update public.jobs set status = 'queued', locked_at = null, locked_by = null,
        attempts = greatest(attempts - 1, 0), run_after = now() + interval '1 day' where id = ${job.id}::uuid`;
    }
    return null;
  } finally {
    for (const s of skipped) await sql`update public.jobs set run_after = ${s.runAfter}::timestamptz where id = ${s.id}::uuid`;
  }
}

function stubResendFetch() {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.resend.com/")) return real(input as Parameters<typeof fetch>[0], init);
    return Promise.resolve(Response.json({ id: "re_1" }));
  });
}

describe("JOB_MODULES gate in the runner (MOD-T11)", () => {
  it("announcements off: the queued job completes succeeded with zero notifications", async () => {
    const inst = await createTestInstitution("mod-t11-jobs-off");
    createdInstitutions.push(inst);
    // publish_announcement enqueues the real job while the module is still
    // on — proving the gate is read at dispatch time, not at enqueue time.
    const announcementId = await publishRoleAnnouncement(inst, "teacher");
    await setModule(inst.institutionId, "announcements", false);

    const ports = withoutSweeps(createRunnerPorts(admin));
    const job = await claimOwnJob(ports, inst.institutionId);
    expect(job?.type).toBe("notify.announcement");
    if (!job) return;
    await expect(ports.dispatch(job)).resolves.toBeUndefined();
    await ports.completeJob(job.id, true);

    const notified = await sql`
      select id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and data->>'key' = ${"announcement:" + announcementId + ":" + inst.users.teacher.id}
    `;
    expect(notified).toHaveLength(0);
    const [jobRow] = await sql`select status from public.jobs where id = ${job.id}::uuid`;
    expect(jobRow.status).toBe("succeeded");
  });

  it("announcements on: the same job type creates a notification for the audience", async () => {
    const inst = await createTestInstitution("mod-t11-jobs-on");
    createdInstitutions.push(inst);
    await publishRoleAnnouncement(inst, "teacher");

    const ports = withoutSweeps(createRunnerPorts(admin));
    const job = await claimOwnJob(ports, inst.institutionId);
    expect(job?.type).toBe("notify.announcement");
    if (!job) return;
    await ports.dispatch(job);
    await ports.completeJob(job.id, true);

    const notified = await sql`
      select id from public.notifications
      where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.teacher.id}::uuid and type = 'announcement'
    `;
    expect(notified).toHaveLength(1);
  });

  it("a core job type (no JOB_MODULES row) is dispatched with no institutions lookup", async () => {
    const inst = await createTestInstitution("mod-t11-jobs-core");
    createdInstitutions.push(inst);
    const key = `mod-t11-core-${crypto.randomUUID()}`;
    // A record id that doesn't exist — the real handler's own "record
    // deleted / nothing to notify" no-op (never thrown) proves the gate let
    // it reach the handler at all, with no institutions lookup in between.
    await sql`select app.enqueue_job(${inst.institutionId}::uuid, 'notify.attendance_absence', ${sql.json({ record_id: crypto.randomUUID() })}, ${key})`;

    const ports = withoutSweeps(createRunnerPorts(admin));
    const job = await claimOwnJob(ports, inst.institutionId);
    expect(job?.idempotency_key).toBe(key);
    if (!job) return;
    await expect(ports.dispatch(job)).resolves.toBeUndefined();
  });
});

describe("email/sms channel drop when the module is off (MOD-T11, rulings \"Channels\")", () => {
  it("email module off + RESEND_API_KEY set: no email delivery attempt, no Resend call, in_app still sent", async () => {
    const inst = await createTestInstitution("mod-t11-email-off");
    createdInstitutions.push(inst);
    await setModule(inst.institutionId, "email", false);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchSpy = stubResendFetch();

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: { title: "Holiday", excerpt: "School closed Friday." },
      contacts: { email: "guardian@school-fixture.in" },
    });

    const attempts = await sql`select channel, status from public.delivery_attempts where notification_id = ${notificationId}::uuid`;
    const channels = attempts.map((a) => a.channel as string);
    expect(channels).not.toContain("email");
    expect(channels).toContain("in_app");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.resend.com/"))).toBe(false);
  });

  it("email module on (default): the email attempt is still made", async () => {
    const inst = await createTestInstitution("mod-t11-email-on");
    createdInstitutions.push(inst);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    stubResendFetch();

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: { title: "Holiday", excerpt: "School closed Friday." },
      contacts: { email: "guardian@school-fixture.in" },
    });

    const attempts = await sql`select channel from public.delivery_attempts where notification_id = ${notificationId}::uuid`;
    expect(attempts.map((a) => a.channel as string)).toContain("email");
  });
});

describe("inviteMember falls back to simulated when email is off (MOD-T11)", () => {
  it("email module off, RESEND_API_KEY + APP_URL set: delivery simulated, no Resend call", async () => {
    const inst = await createTestInstitution("mod-t11-invite-off");
    createdInstitutions.push(inst);
    await setModule(inst.institutionId, "email", false);
    const staffId = await createUnlinkedStaff(inst.institutionId);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("APP_URL", "https://app.coolskool.test");
    const fetchSpy = stubResendFetch();

    const result = await callAs(inst, "admin", inviteMember, {
      email: `invitee-${crypto.randomUUID()}@school-fixture.in`,
      role: "teacher",
      staffId,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.delivery).toBe("simulated");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.resend.com/"))).toBe(false);
  });
});
