// M17-T1 — Resend email adapter + emailChannel() selector. Mirrors the
// "simulated channels never touch the network" style in notification-templates.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emailChannel, resendConfigured, resendEmail } from "../../src/modules/notifications/channels/resend.ts";

const ADDR = "guardian@school-fixture.in";

describe("resendConfigured / emailChannel selector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is false and simulated when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    expect(resendConfigured()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await emailChannel().send({ toAddress: ADDR, renderedBody: "hi", subject: "Hello" });
    expect(result.status).toBe("simulated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is true and sends via resendEmail when RESEND_API_KEY is set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    expect(resendConfigured()).toBe(true);
    expect(emailChannel()).toBe(resendEmail);
  });
});

describe("resendEmail.send", () => {
  beforeEach(() => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts to api.resend.com with Bearer key, to/subject/text, Idempotency-Key, returns sent + providerRef", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ id: "re_123" }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await resendEmail.send({
      toAddress: ADDR,
      renderedBody: "Body text",
      subject: "Subject line",
      idempotencyKey: "notif-1:email",
    });

    expect(result).toMatchObject({ status: "sent", provider: "resend", providerRef: "re_123" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Idempotency-Key"]).toBe("notif-1:email");
    const body = JSON.parse(init.body);
    expect(body.to).toEqual([ADDR]);
    expect(body.subject).toBe("Subject line");
    expect(body.text).toBe("Body text");
    expect(body.html).toBeUndefined();
  });

  it("delegates reserved test domains to simulatedEmail with no fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    for (const addr of ["a@school.test", "a@school.example", "a@school.invalid", "a@school.localhost", "a@example.com", "a@example.net", "a@example.org"]) {
      const result = await resendEmail.send({ toAddress: addr, renderedBody: "x", subject: "s" });
      expect(result.status).toBe("simulated");
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns failed resend_http_500 with no address leaked on non-2xx", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("boom " + ADDR, { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await resendEmail.send({ toAddress: ADDR, renderedBody: "x", subject: "s" });
    expect(result).toMatchObject({ status: "failed", provider: "resend", error: "resend_http_500" });
    expect(result.error).not.toContain(ADDR);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries once on 429 then succeeds", async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "1" } }))
      .mockResolvedValueOnce(Response.json({ id: "re_456" }));
    vi.stubGlobal("fetch", fetchSpy);

    const promise = resendEmail.send({ toAddress: ADDR, renderedBody: "x", subject: "s" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toMatchObject({ status: "sent", provider: "resend", providerRef: "re_456" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns failed resend_network without throwing when fetch rejects", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await resendEmail.send({ toAddress: ADDR, renderedBody: "x", subject: "s" });
    expect(result).toMatchObject({ status: "failed", error: "resend_network" });
  });

  it("returns failed no_contact with no fetch when toAddress is null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await resendEmail.send({ toAddress: null, renderedBody: "x" });
    expect(result).toMatchObject({ status: "failed", error: "no_contact" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
