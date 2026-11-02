import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createNotification } from "@/modules/notifications/service";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

// M17-T2 — real DB test: `createNotification` routes the `email` channel
// through `emailChannel()` (resendConfigured() read per call) instead of
// the always-simulated adapter. Same fixture/admin-client shape as
// tests/db/notifications.test.ts.
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// rulings "Tests never send real mail" — fakes only requests to Resend,
// every other fetch (supabase-js's own HTTP) passes through untouched.
function stubResendFetch(respond: () => Response | Promise<Response>): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    return url.startsWith("https://api.resend.com/") ? Promise.resolve(respond()) : real(input, init);
  });
}

async function emailAttempt(notificationId: string): Promise<{ status: string; provider: string | null; provider_ref: string | null; error: string | null } | undefined> {
  const [row] = await sql`
    select status, provider, provider_ref, error from public.delivery_attempts
    where notification_id = ${notificationId}::uuid and channel = 'email'
  `;
  return row as never;
}

describe("notification service email channel (M17-T2)", () => {
  it("key unset: announcement email attempt is simulated, Resend never called", async () => {
    const inst = await createTestInstitution("notif-email-unset");
    createdInstitutions.push(inst);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: { title: "Holiday", excerpt: "School closed Friday." },
      contacts: { email: "guardian@school-fixture.in" },
    });

    const attempt = await emailAttempt(notificationId);
    expect(attempt?.status).toBe("simulated");
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.resend.com/"))).toBe(false);
  });

  it("key set: attempt sent, provider resend, provider_ref from response, subject = template title", async () => {
    const inst = await createTestInstitution("notif-email-sent");
    createdInstitutions.push(inst);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    let sentBody: { subject?: string } = {};
    const real = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith("https://api.resend.com/")) {
        sentBody = JSON.parse(String(init?.body));
        return Promise.resolve(Response.json({ id: "re_123" }));
      }
      return real(input, init);
    });

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: { title: "Holiday", excerpt: "School closed Friday." },
      contacts: { email: "guardian@school-fixture.in" },
    });

    const attempt = await emailAttempt(notificationId);
    expect(attempt?.status).toBe("sent");
    expect(attempt?.provider).toBe("resend");
    expect(attempt?.provider_ref).toBe("re_123");
    expect(sentBody.subject).toBe("New announcement");
  });

  it("guardian with email opt-out: no email attempt, no Resend call", async () => {
    const inst = await createTestInstitution("notif-email-optout");
    createdInstitutions.push(inst);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await sql`
      insert into public.notification_preferences (user_id, institution_id, category, channel, enabled)
      values (${inst.users.guardian.id}, ${inst.institutionId}, 'announcement', 'email', false)
    `;

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: { title: "Holiday", excerpt: "School closed Friday." },
      contacts: { email: "guardian@school-fixture.in" },
    });

    const attempt = await emailAttempt(notificationId);
    expect(attempt).toBeUndefined();
    expect(fetchSpy.mock.calls.some((c) => String(c[0]).startsWith("https://api.resend.com/"))).toBe(false);
  });

  it("Resend 500: attempt failed with resend_http_500, in_app attempt still written", async () => {
    const inst = await createTestInstitution("notif-email-500");
    createdInstitutions.push(inst);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    stubResendFetch(() => new Response("server error", { status: 500 }));

    const { notificationId } = await createNotification(admin, {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement",
      entityId: crypto.randomUUID(),
      vars: { title: "Holiday", excerpt: "School closed Friday." },
      contacts: { email: "guardian@school-fixture.in" },
    });

    const attempt = await emailAttempt(notificationId);
    expect(attempt?.status).toBe("failed");
    expect(attempt?.error).toBe("resend_http_500");

    const [inAppRow] = await sql`
      select status from public.delivery_attempts
      where notification_id = ${notificationId}::uuid and channel = 'in_app'
    `;
    expect(inAppRow?.status).toBe("sent");
  });

  it("rerun of the same notification does not call Resend again", async () => {
    const inst = await createTestInstitution("notif-email-rerun");
    createdInstitutions.push(inst);
    vi.stubEnv("RESEND_API_KEY", "re_test");
    let resendCalls = 0;
    stubResendFetch(() => {
      resendCalls += 1;
      return Response.json({ id: "re_123" });
    });
    const entityId = crypto.randomUUID();
    const input = {
      institutionId: inst.institutionId,
      recipientUserId: inst.users.guardian.id,
      type: "announcement" as const,
      entityId,
      vars: { title: "Holiday", excerpt: "School closed Friday." },
      contacts: { email: "guardian@school-fixture.in" },
    };

    const first = await createNotification(admin, input);
    expect(resendCalls).toBe(1);

    const second = await createNotification(admin, input);
    expect(second.created).toBe(false);
    expect(second.notificationId).toBe(first.notificationId);
    expect(resendCalls).toBe(1);
  });
});
