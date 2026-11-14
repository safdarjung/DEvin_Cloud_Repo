// X05-T2 — MSG91 WhatsApp adapter. Mirrors the fetch-spy pattern in
// tests/unit/resend-channel.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  msg91WhatsApp,
  simulatedWhatsApp,
  toMsisdn,
  whatsappChannel,
  whatsappConfigured,
} from "../../src/modules/notifications/channels/whatsapp.ts";
import {
  NOTIFICATION_TEMPLATES,
  WHATSAPP_PARAMS,
  whatsappApprovalText,
  whatsappMessage,
  type WhatsAppType,
} from "../../src/modules/notifications/templates.ts";

const PHONE = "9800000001";
const MSISDN = "919800000001";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("whatsappConfigured / whatsappChannel selector", () => {
  it("is false and simulated when MSG91_AUTH_KEY is unset", async () => {
    vi.stubEnv("MSG91_AUTH_KEY", "");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    expect(whatsappConfigured()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await whatsappChannel().send({ toAddress: PHONE, renderedBody: "hi" });
    expect(result.status).toBe("simulated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is false and simulated when MSG91_WA_NUMBER is unset", async () => {
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "");
    expect(whatsappConfigured()).toBe(false);
    expect(whatsappChannel()).toBe(simulatedWhatsApp);
  });

  it("is true and selects msg91WhatsApp when both are set", () => {
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    expect(whatsappConfigured()).toBe(true);
    expect(whatsappChannel()).toBe(msg91WhatsApp);
  });
});

describe("toMsisdn", () => {
  it.each([["9876543210"], ["+91 98765-43210"], ["09876543210"], ["919876543210"]])(
    "normalises %s to 919876543210",
    (input) => {
      expect(toMsisdn(input)).toBe("919876543210");
    },
  );

  it.each([["12345"], ["5876543210"]])("rejects %s", (input) => {
    expect(toMsisdn(input)).toBeNull();
  });
});

describe("simulatedWhatsApp.send", () => {
  it("returns failed no_contact with no fetch when toAddress is null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await simulatedWhatsApp.send({ toAddress: null, renderedBody: "x" });
    expect(result).toMatchObject({ status: "failed", error: "no_contact" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns simulated/simulated-whatsapp with no fetch otherwise", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await simulatedWhatsApp.send({ toAddress: PHONE, renderedBody: "x" });
    expect(result).toMatchObject({ status: "simulated", provider: "simulated-whatsapp" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("msg91WhatsApp.send", () => {
  beforeEach(() => {
    vi.stubEnv("MSG91_AUTH_KEY", "key_test");
    vi.stubEnv("MSG91_WA_NUMBER", "919800000000");
    vi.stubEnv("MSG91_WA_NAMESPACE", "");
  });

  it("returns failed no_contact with no fetch when toAddress is null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await msg91WhatsApp.send({ toAddress: null, renderedBody: "x" });
    expect(result).toMatchObject({ status: "failed", error: "no_contact" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns failed invalid_phone with no fetch when the number is not normalisable", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { template } = whatsappMessage(
      "attendance_absence",
      { student: "Aarav Sharma", class: "X-A", date: "29 Oct 2026", school: "Fabric School" },
      "hi",
    );
    const result = await msg91WhatsApp.send({ toAddress: "12345", renderedBody: "x", template });
    expect(result).toMatchObject({ status: "failed", error: "invalid_phone" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns failed no_template with no fetch when there is no template", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await msg91WhatsApp.send({ toAddress: PHONE, renderedBody: "x" });
    expect(result).toMatchObject({ status: "failed", error: "no_template" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the MSG91 bulk URL with authkey header and body_1..body_4 in order, returns sent + providerRef", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ hasError: false, request_id: "wa_1" }));
    vi.stubGlobal("fetch", fetchSpy);

    const { template } = whatsappMessage(
      "attendance_absence",
      { student: "Aarav Sharma", class: "X-A", date: "29 Oct 2026", school: "Fabric School" },
      "hi",
    );
    const result = await msg91WhatsApp.send({ toAddress: PHONE, renderedBody: "x", template });

    expect(result).toMatchObject({ status: "sent", provider: "msg91", providerRef: "wa_1" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/");
    expect(init.method).toBe("POST");
    expect(init.headers.authkey).toBe("key_test");
    expect(init.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init.body);
    expect(body.integrated_number).toBe("919800000000");
    expect(body.content_type).toBe("template");
    const tpl = body.payload.template;
    expect(tpl.name).toBe("coolskool_attendance_absence");
    expect(tpl.language).toEqual({ code: "hi", policy: "deterministic" });
    expect(tpl.to_and_components).toHaveLength(1);
    expect(tpl.to_and_components[0].to).toEqual(["919800000001"]);
    expect(tpl.to_and_components[0].components).toEqual({
      body_1: { type: "text", value: "Aarav Sharma" },
      body_2: { type: "text", value: "X-A" },
      body_3: { type: "text", value: "29 Oct 2026" },
      body_4: { type: "text", value: "Fabric School" },
    });
  });

  it("returns failed msg91_http_500 on non-2xx with no number digits in error", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("boom " + MSISDN, { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    const { template } = whatsappMessage("announcement", { title: "Annual Day", excerpt: "10 am" }, "en");
    const result = await msg91WhatsApp.send({ toAddress: PHONE, renderedBody: "x", template });

    expect(result).toMatchObject({ status: "failed", provider: "msg91", error: "msg91_http_500" });
    expect(result.error).not.toMatch(/\d{4,}/);
  });

  it("returns failed msg91_rejected on 200 with hasError: true", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ hasError: true }));
    vi.stubGlobal("fetch", fetchSpy);

    const { template } = whatsappMessage("announcement", { title: "Annual Day", excerpt: "10 am" }, "en");
    const result = await msg91WhatsApp.send({ toAddress: PHONE, renderedBody: "x", template });

    expect(result).toMatchObject({ status: "failed", provider: "msg91", error: "msg91_rejected" });
  });

  it("returns failed msg91_network without throwing when fetch rejects", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down " + MSISDN));
    vi.stubGlobal("fetch", fetchSpy);

    const { template } = whatsappMessage("announcement", { title: "Annual Day", excerpt: "10 am" }, "en");
    const result = await msg91WhatsApp.send({ toAddress: PHONE, renderedBody: "x", template });

    expect(result).toMatchObject({ status: "failed", error: "msg91_network" });
  });
});

describe("whatsappMessage param sanitisation", () => {
  it("collapses newlines/tabs, falls back empty to '-', caps length at 300", () => {
    const { template } = whatsappMessage(
      "announcement",
      { title: "Hello\n\tWorld", excerpt: "   " },
      "en",
    );
    expect(template.params[0]).toBe("Hello World");
    expect(template.params[1]).toBe("-");

    const { template: capped } = whatsappMessage("announcement", { title: "x".repeat(400), excerpt: "y" }, "en");
    expect(capped.params[0]).toHaveLength(300);
  });
});

describe("whatsappMessage / WHATSAPP_PARAMS vs varsSchema", () => {
  it("every WHATSAPP_PARAMS key set matches its template's varsSchema keys", () => {
    for (const type of Object.keys(WHATSAPP_PARAMS) as WhatsAppType[]) {
      const schema = NOTIFICATION_TEMPLATES[type].varsSchema as unknown as { shape: Record<string, unknown> };
      const schemaKeys = Object.keys(schema.shape).sort();
      const paramKeys = [...WHATSAPP_PARAMS[type]].sort();
      expect(paramKeys).toEqual(schemaKeys);
    }
  });
});

describe("whatsappApprovalText", () => {
  it("attendance_absence en never starts/ends with {{", () => {
    const text = whatsappApprovalText("attendance_absence", "en");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "School update
      Dear Parent, {{1}} ({{2}}) is marked absent today {{3}}. Contact the class teacher if unplanned. -{{4}}

      Details are in the CoolSkool app."
    `);
  });

  it("attendance_absence hi never starts/ends with {{", () => {
    const text = whatsappApprovalText("attendance_absence", "hi");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "स्कूल अपडेट
      प्रिय अभिभावक, {{1}} ({{2}}) आज {{3}} अनुपस्थित है। अनियोजित होने पर कक्षा शिक्षक से संपर्क करें। -{{4}}

      विवरण CoolSkool ऐप में देखें।"
    `);
  });

  it("results_published en never starts/ends with {{", () => {
    const text = whatsappApprovalText("results_published", "en");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "School update
      Report card of {{1}} for {{2}} is now available in the parent portal. -{{3}}

      Details are in the CoolSkool app."
    `);
  });

  it("results_published hi never starts/ends with {{", () => {
    const text = whatsappApprovalText("results_published", "hi");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "स्कूल अपडेट
      {{1}} की {{2}} की रिपोर्ट कार्ड अब पेरेंट पोर्टल में उपलब्ध है। -{{3}}

      विवरण CoolSkool ऐप में देखें।"
    `);
  });

  it("recheck_decided en never starts/ends with {{", () => {
    const text = whatsappApprovalText("recheck_decided", "en");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "School update
      Recheck for {{1}}, {{2}}: {{3}}. Updated marks: {{4}}. -{{5}}

      Details are in the CoolSkool app."
    `);
  });

  it("recheck_decided hi never starts/ends with {{", () => {
    const text = whatsappApprovalText("recheck_decided", "hi");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "स्कूल अपडेट
      {{1}}, {{2}} के लिए रीचेक: {{3}}। नए अंक: {{4}}। -{{5}}

      विवरण CoolSkool ऐप में देखें।"
    `);
  });

  it("announcement en never starts/ends with {{", () => {
    const text = whatsappApprovalText("announcement", "en");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "School update
      {{1}}: {{2}}

      Details are in the CoolSkool app."
    `);
  });

  it("announcement hi never starts/ends with {{", () => {
    const text = whatsappApprovalText("announcement", "hi");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "स्कूल अपडेट
      सूचना: {{1}} - {{2}}

      विवरण CoolSkool ऐप में देखें।"
    `);
  });

  it("fee_reminder en never starts/ends with {{", () => {
    const text = whatsappApprovalText("fee_reminder", "en");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "School update
      Fee reminder: {{3}} is due for {{1}} (invoice {{2}}, due {{4}}). Please pay at the school office. -{{5}}

      Details are in the CoolSkool app."
    `);
  });

  it("fee_reminder hi never starts/ends with {{", () => {
    const text = whatsappApprovalText("fee_reminder", "hi");
    expect(text.startsWith("{{")).toBe(false);
    expect(text.endsWith("{{")).toBe(false);
    expect(text).toMatchInlineSnapshot(`
      "स्कूल अपडेट
      शुल्क अनुस्मारक: {{1}} के लिए {{3}} बकाया है (चालान {{2}}, देय तिथि {{4}})। कृपया विद्यालय कार्यालय में भुगतान करें। -{{5}}

      विवरण CoolSkool ऐप में देखें।"
    `);
  });
});
