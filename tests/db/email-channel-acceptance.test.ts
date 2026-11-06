// M17-T5 (D42) — email channel acceptance over HTTP: invite + announcement
// fan-out + listDeliveryLog, keyed vs unkeyed. Mirrors
// announcements-acceptance.test.ts (real bearer tokens, real RLS,
// runOnceCore the same way tests/db/jobs.test.ts does) and the passthrough
// fetch-spy pattern from member-invite-actions.test.ts / rulings. Own
// fixture institution; cleans up (including the extra guardian auth user
// it creates).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { POST as actionsPost } from "@/app/api/v1/actions/[name]/route";
import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";
import { withoutSweeps } from "../helpers/runner-ports";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

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

async function createUnlinkedStaff(institutionId: string): Promise<string> {
  const [row] = await sql`
    insert into public.staff (institution_id, employee_no, full_name, designation)
    values (${institutionId}, ${`EMP-${crypto.randomUUID().slice(0, 8)}`}, 'Unlinked Staff', 'Teacher')
    returning id
  `;
  return row.id as string;
}

/** A second, independently-emailed guardian with an active membership (own auth user — not in the fixture's 1-per-role set). */
async function addSecondGuardian(institutionId: string, email: string): Promise<{ userId: string }> {
  const { data, error } = await admin.auth.admin.createUser({
    email: `second-guardian-${crypto.randomUUID()}@test.coolskool.test`,
    password: "correct-horse-battery-staple",
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("failed to create second guardian user");
  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone, email)
    values (${institutionId}, 'Second Guardian', '9876543210', ${email})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  return { userId: data.user.id };
}

// Passthrough spy (rulings): only api.resend.com is faked, everything else
// (supabase-js's own fetch calls) goes to the real fetch.
function stubResendFetch(responseInit?: { status?: number; id?: string }) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith("https://api.resend.com/")) return real(input as Parameters<typeof fetch>[0], init);
    if (responseInit?.status && responseInit.status >= 300) {
      return Promise.resolve(new Response("boom", { status: responseInit.status }));
    }
    return Promise.resolve(Response.json({ id: responseInit?.id ?? "re_1" }));
  });
}

function resendCallsOf(spy: ReturnType<typeof stubResendFetch>) {
  return spy.mock.calls.filter(([i]) => String(i instanceof Request ? i.url : i).startsWith("https://api.resend.com/"));
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("M17 email channel acceptance: invite + announcement fan-out + listDeliveryLog, over HTTP", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("key stubbed: invite sends, announcement fan-out sends to a real address and simulates a reserved one, listDeliveryLog shows both, rerun makes no extra call", async () => {
    const inst = await createTestInstitution("email-acceptance-keyed");
    let secondGuardianUserId: string | undefined;
    try {
      vi.stubEnv("RESEND_API_KEY", "re_test");
      vi.stubEnv("APP_URL", "https://app.coolskool.test");
      const fetchSpy = stubResendFetch({ id: "re_1" });

      const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };

      // --- invite over HTTP: delivery: "sent" ------------------------
      const staffId = await createUnlinkedStaff(inst.institutionId);
      const inviteRes = await dispatchAction(
        "core.member.invite",
        { institution: inst.slug, input: { email: `invitee-${crypto.randomUUID()}@school-fixture.in`, role: "teacher", staffId } },
        adminAuth,
      );
      expect(inviteRes.status).toBe(200);
      const inviteBody = await inviteRes.json();
      expect(inviteBody.ok).toBe(true);
      expect(inviteBody.data.delivery).toBe("sent");
      expect(resendCallsOf(fetchSpy)).toHaveLength(1);

      // --- second guardian, real (non-reserved) address --------------
      const realEmail = `guardian-${crypto.randomUUID()}@school-fixture.in`;
      const second = await addSecondGuardian(inst.institutionId, realEmail);
      secondGuardianUserId = second.userId;

      // --- the fixture guardian keeps a reserved-domain address -------
      await sql`update public.guardians set email = ${`guardian-${crypto.randomUUID()}@test.coolskool.test`} where institution_id = ${inst.institutionId}::uuid and id = (select guardian_id from public.memberships where institution_id = ${inst.institutionId}::uuid and user_id = ${inst.users.guardian.id}::uuid)`;

      // --- admin creates + publishes a school-wide announcement ------
      const createRes = await dispatchAction(
        "announcement.create",
        {
          institution: inst.slug,
          input: { title: "School Notice", body: "Everyone please note the new timings.", audiences: [{ type: "school" }] },
        },
        adminAuth,
      );
      expect(createRes.status).toBe(200);
      const createBody = await createRes.json();
      expect(createBody.ok).toBe(true);
      const announcementId = createBody.data.announcementId as string;

      const publishRes = await dispatchAction("announcement.publish", { institution: inst.slug, input: { announcementId } }, adminAuth);
      expect(publishRes.status).toBe(200);
      expect((await publishRes.json()).ok).toBe(true);

      // --- job runner fans the announcement out, once -----------------
      const summary = await runOnceCore({ workerId: "test-worker-email-acceptance" }, withoutSweeps(createRunnerPorts(admin)));
      expect(summary.succeeded).toBeGreaterThanOrEqual(1);
      expect(summary.dead).toBe(0);

      const callsAfterFirstRun = resendCallsOf(fetchSpy).length;
      expect(callsAfterFirstRun).toBe(2); // invite (above) + the one real-address announcement email

      // --- real-address guardian: email attempt sent via resend -------
      const [realGuardianNotification] = await sql<{ id: string }[]>`
        select id from public.notifications
        where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${secondGuardianUserId}::uuid and type = 'announcement'
      `;
      expect(realGuardianNotification).toBeDefined();
      const [realAttempt] = await sql<{ status: string; provider: string | null; provider_ref: string | null }[]>`
        select status, provider, provider_ref from public.delivery_attempts
        where notification_id = ${realGuardianNotification.id}::uuid and channel = 'email'
      `;
      expect(realAttempt).toMatchObject({ status: "sent", provider: "resend", provider_ref: "re_1" });

      // --- reserved-domain guardian: email attempt simulated, no network
      const [reservedGuardianNotification] = await sql<{ id: string }[]>`
        select id from public.notifications
        where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.guardian.id}::uuid and type = 'announcement'
      `;
      expect(reservedGuardianNotification).toBeDefined();
      const [reservedAttempt] = await sql<{ status: string }[]>`
        select status from public.delivery_attempts
        where notification_id = ${reservedGuardianNotification.id}::uuid and channel = 'email'
      `;
      expect(reservedAttempt.status).toBe("simulated");

      // --- listDeliveryLog shows both statuses -------------------------
      const logRes = await dispatchQuery("notifications.listDeliveryLog", inst.slug, {}, adminAuth);
      expect(logRes.status).toBe(200);
      const logBody = await logRes.json();
      expect(logBody.ok).toBe(true);
      const emailStatuses = (logBody.data as { channel: string; status: string }[])
        .filter((row) => row.channel === "email")
        .map((row) => row.status);
      expect(emailStatuses).toContain("sent");
      expect(emailStatuses).toContain("simulated");

      // --- rerunning the job (nothing left to claim) makes no extra call
      const rerun = await runOnceCore({ workerId: "test-worker-email-acceptance-2" }, withoutSweeps(createRunnerPorts(admin)));
      expect(rerun.succeeded).toBe(0);
      expect(resendCallsOf(fetchSpy)).toHaveLength(callsAfterFirstRun);
    } finally {
      if (secondGuardianUserId) await admin.auth.admin.deleteUser(secondGuardianUserId);
      await inst.cleanup();
    }
  });

  it("key unstubbed: invite + announcement fan-out both yield only simulated deliveries and zero Resend calls", async () => {
    const inst = await createTestInstitution("email-acceptance-unkeyed");
    try {
      const fetchSpy = stubResendFetch();
      const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };

      const staffId = await createUnlinkedStaff(inst.institutionId);
      const inviteRes = await dispatchAction(
        "core.member.invite",
        { institution: inst.slug, input: { email: `invitee-${crypto.randomUUID()}@school-fixture.in`, role: "teacher", staffId } },
        adminAuth,
      );
      expect((await inviteRes.json()).data.delivery).toBe("simulated");

      await sql`update public.guardians set email = ${`guardian-${crypto.randomUUID()}@school-fixture.in`} where institution_id = ${inst.institutionId}::uuid and id = (select guardian_id from public.memberships where institution_id = ${inst.institutionId}::uuid and user_id = ${inst.users.guardian.id}::uuid)`;

      const createRes = await dispatchAction(
        "announcement.create",
        { institution: inst.slug, input: { title: "Unkeyed Notice", body: "No key configured.", audiences: [{ type: "school" }] } },
        adminAuth,
      );
      const announcementId = (await createRes.json()).data.announcementId as string;
      await dispatchAction("announcement.publish", { institution: inst.slug, input: { announcementId } }, adminAuth);

      const summary = await runOnceCore({ workerId: "test-worker-email-acceptance-unkeyed" }, withoutSweeps(createRunnerPorts(admin)));
      expect(summary.succeeded).toBeGreaterThanOrEqual(1);

      const [notification] = await sql<{ id: string }[]>`
        select id from public.notifications
        where institution_id = ${inst.institutionId}::uuid and recipient_user_id = ${inst.users.guardian.id}::uuid and type = 'announcement'
      `;
      const [attempt] = await sql<{ status: string }[]>`
        select status from public.delivery_attempts where notification_id = ${notification.id}::uuid and channel = 'email'
      `;
      expect(attempt.status).toBe("simulated");
      expect(resendCallsOf(fetchSpy)).toHaveLength(0);
    } finally {
      await inst.cleanup();
    }
  });
});
