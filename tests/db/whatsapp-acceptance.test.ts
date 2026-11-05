// X05-T5 — WhatsApp acceptance over HTTP. Mirrors
// tests/db/email-channel-acceptance.test.ts (real bearer tokens, real RLS,
// runOnceCore the same way tests/db/jobs.test.ts does, passthrough fetch
// spy) and tests/db/announcements-acceptance.test.ts (section audience,
// guardian opt-out). Own fixture institution; cleans up (incl. the second
// guardian auth user it creates).
import { createClient } from "@supabase/supabase-js";
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
import { MODULE_DISABLED_MESSAGE } from "@/lib/modules/catalog";
import { createRunnerPorts, runOnceCore } from "@/modules/jobs/runner";
import { closeRolesHelper, createTestInstitution, type FixtureRole, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

// Full fixture (9 roles) + section + two guardian auth users — slower than
// the default 5000ms under a loaded dev box; file-local only.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const PASSWORD = "correct-horse-battery-staple";
const GUARDIAN_B_PHONE = "9876500001";

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

// rulings "Tests never send" — fakes only api.msg91.com; every other fetch
// (supabase-js's own HTTP) passes through to the real fetch.
function stubMsg91Fetch(respond: () => Response | Promise<Response>) {
  const real = globalThis.fetch;
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith("https://api.msg91.com/")) return real(input as Parameters<typeof fetch>[0], init);
    return Promise.resolve(respond());
  });
}

function msg91Calls(spy: ReturnType<typeof stubMsg91Fetch>): { body: Record<string, unknown> }[] {
  return spy.mock.calls
    .filter(([i]) => String(i instanceof Request ? i.url : i).startsWith("https://api.msg91.com/"))
    .map(([, init]) => ({ body: JSON.parse(String((init as RequestInit | undefined)?.body ?? "{}")) }));
}

/** Current academic year + one grade + one section, with the fixture student actively enrolled. */
async function makeSectionFixture(inst: TestInstitution): Promise<{ sectionId: string; studentId: string }> {
  const [year] = await sql`
    insert into public.academic_years (institution_id, name, starts_on, ends_on, is_current)
    values (${inst.institutionId}, 'AY', '2026-04-01', '2027-03-31', true)
    returning id
  `;
  const [grade] = await sql`
    insert into public.grades (institution_id, code, display_name, sort_key, grade_group)
    values (${inst.institutionId}, 'VI', 'Grade VI', 6, 'middle')
    returning id
  `;
  const [section] = await sql`
    insert into public.class_sections (institution_id, grade_id, academic_year_id, name)
    values (${inst.institutionId}, ${grade.id}, ${year.id}, 'A')
    returning id
  `;

  const [studentMembership] = await sql`
    select student_id from public.memberships where institution_id = ${inst.institutionId} and user_id = ${inst.users.student.id}
  `;
  const studentId = studentMembership.student_id as string;
  await sql`
    insert into public.enrolments (institution_id, student_id, class_section_id, academic_year_id, started_on, status)
    values (${inst.institutionId}, ${studentId}, ${section.id}, ${year.id}, '2026-04-01', 'active')
  `;

  return { sectionId: section.id as string, studentId };
}

/** A second guardian (own auth user, own token), linked to the fixture student via guardian_students. */
async function createGuardianB(inst: TestInstitution, studentId: string): Promise<{ token: string; userId: string }> {
  const email = `wa-guardian-b-${crypto.randomUUID()}@test.coolskool.test`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("failed to create second guardian user");

  const [guardian] = await sql`
    insert into public.guardians (institution_id, full_name, phone)
    values (${inst.institutionId}, 'Guardian B', ${GUARDIAN_B_PHONE})
    returning id
  `;
  await sql`
    insert into public.memberships (institution_id, user_id, role, guardian_id)
    values (${inst.institutionId}, ${data.user.id}, 'guardian', ${guardian.id})
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${guardian.id}, ${studentId}, 'mother', false, true)
  `;

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  const { error: signInError } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInError) throw signInError;
  const { data: session, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session.session) throw sessionError ?? new Error("no session for guardian B");
  return { token: session.session.access_token, userId: data.user.id };
}

/** Guardian A (the fixture's own guardian) also needs guardian_students for the section audience to reach them. */
async function linkGuardianA(inst: TestInstitution, studentId: string): Promise<{ phone: string }> {
  const [row] = await sql<{ id: string; phone: string }[]>`
    select g.id, g.phone from public.guardians g
    join public.memberships m on m.guardian_id = g.id
    where m.institution_id = ${inst.institutionId}::uuid and m.user_id = ${inst.users.guardian.id}::uuid
  `;
  await sql`
    insert into public.guardian_students (institution_id, guardian_id, student_id, relationship, is_primary, portal_access)
    values (${inst.institutionId}, ${row.id}, ${studentId}, 'father', true, true)
  `;
  return { phone: row.phone };
}

async function publishSectionAnnouncement(
  adminAuth: Record<string, string>,
  inst: TestInstitution,
  sectionId: string,
  title: string,
  body: string,
): Promise<void> {
  const createRes = await dispatchAction(
    "announcement.create",
    { institution: inst.slug, input: { title, body, audiences: [{ type: "section", classSectionId: sectionId }] } },
    adminAuth,
  );
  expect(createRes.status).toBe(200);
  const announcementId = (await createRes.json()).data.announcementId as string;
  const publishRes = await dispatchAction("announcement.publish", { institution: inst.slug, input: { announcementId } }, adminAuth);
  expect(publishRes.status).toBe(200);
}

// Notification `title` is the fixed per-type template title ("New
// announcement"); the announcement's own title is interpolated into
// `body` as `${title}: ${excerpt}` (templates.ts) — match on body.
async function whatsappAttempt(institutionId: string, recipientUserId: string, announcementTitle: string): Promise<
  { status: string; provider: string | null; provider_ref: string | null } | undefined
> {
  const [row] = await sql`
    select da.status, da.provider, da.provider_ref from public.delivery_attempts da
    join public.notifications n on n.id = da.notification_id
    where n.institution_id = ${institutionId}::uuid and n.recipient_user_id = ${recipientUserId}::uuid
      and n.type = 'announcement' and n.body ilike ${`${announcementTitle}:%`} and da.channel = 'whatsapp'
  `;
  return row as never;
}

async function smsAttemptExists(institutionId: string, recipientUserId: string, announcementTitle: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from public.delivery_attempts da
    join public.notifications n on n.id = da.notification_id
    where n.institution_id = ${institutionId}::uuid and n.recipient_user_id = ${recipientUserId}::uuid
      and n.type = 'announcement' and n.body ilike ${`${announcementTitle}:%`} and da.channel = 'sms'
  `;
  return Boolean(row);
}

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

describe("X05-T5 WhatsApp acceptance over HTTP: opt-out, provider send, module gate, listDeliveryLog", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("guardian B opts out, guardian A gets a real MSG91 send, module off blocks preference + fan-out, module back on + no key simulates", async () => {
    const inst = await createTestInstitution("whatsapp-acceptance");
    let guardianBUserId: string | undefined;
    try {
      await sql`update public.institutions set is_demo = false where id = ${inst.institutionId}::uuid`;
      const { sectionId, studentId } = await makeSectionFixture(inst);
      const guardianA = await linkGuardianA(inst, studentId);
      const guardianB = await createGuardianB(inst, studentId);
      guardianBUserId = guardianB.userId;

      const adminAuth = { authorization: `Bearer ${await tokenFor(inst, "admin")}` };
      const guardianAAuth = { authorization: `Bearer ${await tokenFor(inst, "guardian")}` };
      const guardianBAuth = { authorization: `Bearer ${guardianB.token}` };

      // --- 1. guardian B opts out of whatsapp for 'announcement' --------
      const optOutRes = await dispatchAction(
        "notification.preferences.set",
        { institution: inst.slug, input: { category: "announcement", channel: "whatsapp", enabled: false } },
        guardianBAuth,
      );
      expect(optOutRes.status).toBe(200);
      expect((await optOutRes.json()).ok).toBe(true);

      // --- 2. admin publishes + runner fans out, MSG91 key stubbed ------
      vi.stubEnv("MSG91_AUTH_KEY", "key_test");
      vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
      const fetchSpy = stubMsg91Fetch(() => Response.json({ hasError: false, request_id: "wa_1" }));

      await publishSectionAnnouncement(adminAuth, inst, sectionId, "WhatsApp Acceptance Notice", "Please read this notice.");

      const summary = await runOnceCore({ workerId: "test-worker-whatsapp-acceptance" }, createRunnerPorts(admin));
      expect(summary.succeeded).toBeGreaterThanOrEqual(1);
      expect(summary.dead).toBe(0);

      const attemptA = await whatsappAttempt(inst.institutionId, inst.users.guardian.id, "WhatsApp Acceptance Notice");
      expect(attemptA).toMatchObject({ status: "sent", provider: "msg91", provider_ref: "wa_1" });

      const callsAfterFirstRun = msg91Calls(fetchSpy);
      expect(callsAfterFirstRun).toHaveLength(1);
      const sentPayload = callsAfterFirstRun[0].body.payload as {
        template: {
          name: string;
          language: { code: string };
          to_and_components: { to: string[]; components: Record<string, { value: string }> }[];
        };
      };
      expect(sentPayload.template.name).toBe("coolskool_announcement");
      expect(sentPayload.template.to_and_components[0].to).toEqual([`91${guardianA.phone}`]);
      expect(sentPayload.template.to_and_components[0].components.body_1.value).toBe("WhatsApp Acceptance Notice");

      const attemptB = await whatsappAttempt(inst.institutionId, guardianBUserId, "WhatsApp Acceptance Notice");
      expect(attemptB).toBeUndefined();
      expect(await smsAttemptExists(inst.institutionId, guardianBUserId, "WhatsApp Acceptance Notice")).toBe(true);

      // --- admin's delivery log includes a whatsapp row ------------------
      const logRes = await dispatchQuery("notifications.listDeliveryLog", inst.slug, {}, adminAuth);
      expect(logRes.status).toBe(200);
      const logBody = await logRes.json();
      const channels = (logBody.data as { channel: string }[]).map((r) => r.channel);
      expect(channels).toContain("whatsapp");

      // --- rerun: nothing left to claim, no extra MSG91 call -------------
      const rerun = await runOnceCore({ workerId: "test-worker-whatsapp-acceptance-2" }, createRunnerPorts(admin));
      expect(rerun.succeeded).toBe(0);
      expect(msg91Calls(fetchSpy)).toHaveLength(1);

      // --- 3. admin turns the whatsapp module off -------------------------
      const disableRes = await dispatchAction("core.module.set", { institution: inst.slug, input: { key: "whatsapp", enabled: false } }, adminAuth);
      expect(disableRes.status).toBe(200);

      const blockedPrefRes = await dispatchAction(
        "notification.preferences.set",
        { institution: inst.slug, input: { category: "announcement", channel: "whatsapp", enabled: false } },
        guardianAAuth,
      );
      expect(blockedPrefRes.status).toBe(403);
      const blockedPrefBody = await blockedPrefRes.json();
      expect(blockedPrefBody.ok).toBe(false);
      expect(blockedPrefBody.error).toMatchObject({ code: "forbidden", message: MODULE_DISABLED_MESSAGE });

      await publishSectionAnnouncement(adminAuth, inst, sectionId, "Second Notice Module Off", "Second body.");
      const summary2 = await runOnceCore({ workerId: "test-worker-whatsapp-acceptance-3" }, createRunnerPorts(admin));
      expect(summary2.succeeded).toBeGreaterThanOrEqual(1);

      const attemptAModuleOff = await whatsappAttempt(inst.institutionId, inst.users.guardian.id, "Second Notice Module Off");
      expect(attemptAModuleOff).toBeUndefined();
      expect(msg91Calls(fetchSpy)).toHaveLength(1);

      // --- 4. module back on, key unstubbed -> simulated, zero calls -----
      vi.unstubAllEnvs();
      const enableRes = await dispatchAction("core.module.set", { institution: inst.slug, input: { key: "whatsapp", enabled: true } }, adminAuth);
      expect(enableRes.status).toBe(200);

      await publishSectionAnnouncement(adminAuth, inst, sectionId, "Third Notice Unkeyed", "Third body.");
      const summary3 = await runOnceCore({ workerId: "test-worker-whatsapp-acceptance-4" }, createRunnerPorts(admin));
      expect(summary3.succeeded).toBeGreaterThanOrEqual(1);

      const attemptAThird = await whatsappAttempt(inst.institutionId, inst.users.guardian.id, "Third Notice Unkeyed");
      expect(attemptAThird?.status).toBe("simulated");
      expect(msg91Calls(fetchSpy)).toHaveLength(1);
    } finally {
      if (guardianBUserId) await admin.auth.admin.deleteUser(guardianBUserId);
      await sql`update public.institutions set is_demo = true where id = ${inst.institutionId}::uuid`;
      await inst.cleanup();
    }
  });
});
