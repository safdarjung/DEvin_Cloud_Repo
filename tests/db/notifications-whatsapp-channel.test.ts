import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createNotification } from "@/modules/notifications/service";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// X05-T3 — real DB test: createNotification routes the "whatsapp" channel
// through channelFor (simulatedWhatsApp for a demo institution, else
// whatsappChannel()). Same fixture/admin-client shape as
// tests/db/notifications-email-channel.test.ts.
process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

// Each case creates a full 9-role fixture institution (tests/helpers/roles.ts)
// — slower than the default 5000ms under a loaded dev box; file-local only,
// vitest.config.mts (shared) stays untouched.
vi.setConfig({ testTimeout: 20_000, hookTimeout: 20_000 });

afterAll(async () => {
  await sql.end();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  const insts = createdInstitutions.splice(0);
  // app.demo_reset (called by inst.cleanup()) raises code:forbidden unless
  // is_demo = true (0001) — restore it before cleanup for every fixture
  // this file flipped to false (setNotDemo below).
  await Promise.all(insts.map((inst) => sql`update public.institutions set is_demo = true where id = ${inst.institutionId}::uuid`));
  await Promise.all(insts.map((inst) => inst.cleanup()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// createTestInstitution always sets is_demo = true (tests/helpers/roles.ts);
// rulings "Demo safety" needs is_demo = false for every case not about the
// demo guard itself.
async function setNotDemo(institutionId: string): Promise<void> {
  await sql`update public.institutions set is_demo = false where id = ${institutionId}::uuid`;
}

// rulings "Tests never send" — fakes only requests to MSG91, every other
// fetch (supabase-js's own HTTP) passes through untouched.
function stubMsg91Fetch(respond: () => Response | Promise<Response>): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.startsWith("https://api.msg91.com/") ? Promise.resolve(respond()) : real(input, init);
  });
}

async function whatsappAttempt(notificationId: string): Promise<
  { status: string; provider: string | null; provider_ref: string | null; to_address: string | null; error: string | null; rendered_body: string } | undefined
> {
  const [row] = await sql`
    select status, provider, provider_ref, to_address, error, rendered_body from public.delivery_attempts
    where notification_id = ${notificationId}::uuid and channel = 'whatsapp'
  `;
  return row as never;
}

const PHONE = "9876543210";
const ANNOUNCEMENT_VARS = { title: "Holiday", excerpt: "School closed Friday." };

describe("notification service whatsapp channel (X05-T3)", () => {
  it("key unset: announcement gives in_app + sms + whatsapp attempts, whatsapp is simulated, zero MSG91 calls", async () => {
    const inst = await createTestInstitution("notif-wa-unset");
    createdInstitutions.push(inst);
    await setNotDemo(inst.institutionId);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: ANNOUNCEMENT_VARS,
      contacts: { sms: PHONE },
    });

    // announcement also carries "email" (pre-existing, no contacts.email
    // given here) — not this test's concern, excluded from the assertion.
    const channels = await sql`select channel from public.delivery_attempts where notification_id = ${notificationId}::uuid and channel != 'email' order by channel`;
    expect(channels.map((c) => c.channel)).toEqual(["in_app", "sms", "whatsapp"]);

    const attempt = await whatsappAttempt(notificationId);
    expect(attempt?.status).toBe("simulated");
    expect(attempt?.provider).toBe("simulated-whatsapp");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.msg91.com/"))).toBe(false);
  });

  it("key + number stubbed: sent, provider msg91, provider_ref from response, to_address = guardian phone, rendered_body starts with heading", async () => {
    const inst = await createTestInstitution("notif-wa-sent");
    createdInstitutions.push(inst);
    await setNotDemo(inst.institutionId);
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    stubMsg91Fetch(() => Response.json({ hasError: false, request_id: "wa_1" }));

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: ANNOUNCEMENT_VARS,
      contacts: { sms: PHONE },
    });

    const attempt = await whatsappAttempt(notificationId);
    expect(attempt?.status).toBe("sent");
    expect(attempt?.provider).toBe("msg91");
    expect(attempt?.provider_ref).toBe("wa_1");
    expect(attempt?.to_address).toBe(PHONE);
    expect(attempt?.rendered_body.startsWith("School update")).toBe(true);
  });

  it("guardian with whatsapp opt-out for announcement: no whatsapp attempt, sms attempt present, zero MSG91 calls", async () => {
    const inst = await createTestInstitution("notif-wa-optout");
    createdInstitutions.push(inst);
    await setNotDemo(inst.institutionId);
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sql`
      insert into public.notification_preferences (user_id, institution_id, category, channel, enabled)
      values (${inst.users.guardian.id}, ${inst.institutionId}, 'announcement', 'whatsapp', false)
    `;

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: ANNOUNCEMENT_VARS,
      contacts: { sms: PHONE },
    });

    const attempt = await whatsappAttempt(notificationId);
    expect(attempt).toBeUndefined();
    const [sms] = await sql`select status from public.delivery_attempts where notification_id = ${notificationId}::uuid and channel = 'sms'`;
    expect(sms?.status).toBe("simulated");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.msg91.com/"))).toBe(false);
  });

  it("settings.modules.whatsapp = false: no whatsapp attempt, zero MSG91 calls", async () => {
    const inst = await createTestInstitution("notif-wa-module-off");
    createdInstitutions.push(inst);
    await setNotDemo(inst.institutionId);
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sql`
      update public.institutions
      set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', 'whatsapp'], 'false'::jsonb)
      where id = ${inst.institutionId}::uuid
    `;

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: ANNOUNCEMENT_VARS,
      contacts: { sms: PHONE },
    });

    const attempt = await whatsappAttempt(notificationId);
    expect(attempt).toBeUndefined();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.msg91.com/"))).toBe(false);
  });

  it("is_demo = true + key set: simulated, zero MSG91 calls", async () => {
    const inst = await createTestInstitution("notif-wa-demo");
    createdInstitutions.push(inst);
    // is_demo stays true (createTestInstitution default) — this case is
    // about the demo guard itself.
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: ANNOUNCEMENT_VARS,
      contacts: { sms: PHONE },
    });

    const attempt = await whatsappAttempt(notificationId);
    expect(attempt?.status).toBe("simulated");
    expect(attempt?.provider).toBe("simulated-whatsapp");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.msg91.com/"))).toBe(false);
  });

  it("MSG91 500: failed msg91_http_500, in_app attempt still written", async () => {
    const inst = await createTestInstitution("notif-wa-500");
    createdInstitutions.push(inst);
    await setNotDemo(inst.institutionId);
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    stubMsg91Fetch(() => new Response("server error", { status: 500 }));

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: ANNOUNCEMENT_VARS,
      contacts: { sms: PHONE },
    });

    const attempt = await whatsappAttempt(notificationId);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.error).toBe("msg91_http_500");

    const [inAppRow] = await sql`select status from public.delivery_attempts where notification_id = ${notificationId}::uuid and channel = 'in_app'`;
    expect(inAppRow?.status).toBe("sent");
  });

  it("rerun of the same notification does not call MSG91 again", async () => {
    const inst = await createTestInstitution("notif-wa-rerun");
    createdInstitutions.push(inst);
    await setNotDemo(inst.institutionId);
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    let msg91Calls = 0;
    stubMsg91Fetch(() => {
      msg91Calls += 1;
      return Response.json({ hasError: false, request_id: "wa_1" });
    });
    const entityId = crypto.randomUUID();
    const input = {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement" as const,
      entityId,
      vars: ANNOUNCEMENT_VARS,
      contacts: { sms: PHONE },
    };

    const first = await createNotification(admin, input);
    expect(msg91Calls).toBe(1);

    const second = await createNotification(admin, input);
    expect(second.created).toBe(false);
    expect(second.notificationId).toBe(first.notificationId);
    expect(msg91Calls).toBe(1);
  });
});
