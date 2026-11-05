// M12-T10 — Razorpay client (fetch + HMAC). Mode calc, order creation via a
// mocked fetch, and HMAC-SHA256 webhook signature verification. Mirrors the
// "simulated unless configured" style in resend-channel.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { onlinePaymentsMode, createRazorpayOrder, verifyRazorpaySignature } from "../../src/modules/finance/razorpay.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeEnv(vars: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return vars as NodeJS.ProcessEnv;
}

describe("onlinePaymentsMode", () => {
  it("is simulated when no keys are set", () => {
    expect(onlinePaymentsMode(fakeEnv({}))).toBe("simulated");
  });

  it("is simulated for a rzp_live_ key even with a secret", () => {
    expect(onlinePaymentsMode(fakeEnv({ RAZORPAY_KEY_ID: "rzp_live_abc", RAZORPAY_KEY_SECRET: "s" }))).toBe(
      "simulated",
    );
  });

  it("is simulated for a rzp_test_ key with no secret", () => {
    expect(onlinePaymentsMode(fakeEnv({ RAZORPAY_KEY_ID: "rzp_test_abc" }))).toBe("simulated");
  });

  it("is test for a rzp_test_ key with a secret", () => {
    expect(onlinePaymentsMode(fakeEnv({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "s" }))).toBe("test");
  });
});

const TEST_ENV = fakeEnv({ RAZORPAY_KEY_ID: "rzp_test_abc", RAZORPAY_KEY_SECRET: "topsecret" });

describe("createRazorpayOrder", () => {
  it("POSTs Basic auth, integer paise, INR, and returns the order id", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ id: "order_ABC123" }));

    const result = await createRazorpayOrder(
      { amountPaise: 150000, receipt: "invoice-1", notes: { invoice_id: "inv-1" } },
      { fetch: fetchSpy, env: TEST_ENV },
    );

    expect(result).toEqual({ orderId: "order_ABC123" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("rzp_test_abc:topsecret").toString("base64")}`);
    const body = JSON.parse(init.body);
    expect(body.amount).toBe(150000);
    expect(Number.isInteger(body.amount)).toBe(true);
    expect(body.currency).toBe("INR");
    expect(body.receipt).toBe("invoice-1");
    expect(body.notes).toEqual({ invoice_id: "inv-1" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("throws dependency_failed without calling fetch when not in test mode", async () => {
    const fetchSpy = vi.fn();

    await expect(
      createRazorpayOrder({ amountPaise: 100, receipt: "r", notes: {} }, { fetch: fetchSpy, env: fakeEnv({}) }),
    ).rejects.toMatchObject({ code: "dependency_failed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws dependency_failed with no body/key leaked on a non-2xx response", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("bad key topsecret", { status: 500 }));

    let caught: unknown;
    try {
      await createRazorpayOrder({ amountPaise: 100, receipt: "r", notes: {} }, { fetch: fetchSpy, env: TEST_ENV });
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: "dependency_failed" });
    expect((caught as Error).message).not.toContain("topsecret");
    expect((caught as Error).message).not.toContain("bad key");
  });

  it("throws dependency_failed on a malformed (non-order_ id) response body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(Response.json({ id: "not-an-order" }));

    await expect(
      createRazorpayOrder({ amountPaise: 100, receipt: "r", notes: {} }, { fetch: fetchSpy, env: TEST_ENV }),
    ).rejects.toMatchObject({ code: "dependency_failed" });
  });

  it("throws dependency_failed when fetch rejects (network error / timeout)", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new DOMException("The operation was aborted.", "TimeoutError"));

    await expect(
      createRazorpayOrder({ amountPaise: 100, receipt: "r", notes: {} }, { fetch: fetchSpy, env: TEST_ENV }),
    ).rejects.toMatchObject({ code: "dependency_failed" });
  });
});

describe("verifyRazorpaySignature", () => {
  const secret = "whsec_abc";
  const rawBody = JSON.stringify({ event: "payment.captured" });
  const validSignature = createHmac("sha256", secret).update(rawBody).digest("hex");

  it("returns true for a matching signature", () => {
    expect(verifyRazorpaySignature(rawBody, validSignature, secret)).toBe(true);
  });

  it("returns false when one body byte changes", () => {
    const tampered = rawBody.replace("payment", "Payment");
    expect(verifyRazorpaySignature(tampered, validSignature, secret)).toBe(false);
  });

  it("returns false for a missing signature", () => {
    expect(verifyRazorpaySignature(rawBody, null, secret)).toBe(false);
  });

  it("returns false for a short/truncated signature", () => {
    expect(verifyRazorpaySignature(rawBody, validSignature.slice(0, 10), secret)).toBe(false);
  });

  it("never throws on a garbage signature", () => {
    expect(() => verifyRazorpaySignature(rawBody, "not-hex-!!", secret)).not.toThrow();
    expect(verifyRazorpaySignature(rawBody, "not-hex-!!", secret)).toBe(false);
  });
});
