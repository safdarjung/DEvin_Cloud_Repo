import "server-only";
// M12-T10 (rulings: "Online payments", "Webhook", "Mode + honesty badges") —
// Razorpay test-mode client: no SDK, fetch + node:crypto only (no new deps).
// `onlinePaymentsMode`/`createRazorpayOrder` take an optional `env`/`fetch`
// so callers (and tests) never touch real network or process.env directly.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/actions/result";

const RAZORPAY_ORDERS_URL = "https://api.razorpay.com/v1/orders";
const ORDER_CREATE_TIMEOUT_MS = 10_000;

export function onlinePaymentsMode(env: NodeJS.ProcessEnv = process.env): "test" | "simulated" {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  return keyId?.startsWith("rzp_test_") && keySecret ? "test" : "simulated";
}

const RazorpayOrderResponseSchema = z.object({ id: z.string().regex(/^order_/) });

export async function createRazorpayOrder(
  input: { amountPaise: number; receipt: string; notes: Record<string, string> },
  deps: { fetch?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<{ orderId: string }> {
  const env = deps.env ?? process.env;
  const doFetch = deps.fetch ?? fetch;

  if (onlinePaymentsMode(env) !== "test") {
    throw new AppError("dependency_failed", "Online payments are not configured for test-mode order creation.");
  }

  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64");

  let res: Response;
  try {
    res = await doFetch(RAZORPAY_ORDERS_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: input.amountPaise,
        currency: "INR",
        receipt: input.receipt,
        notes: input.notes,
      }),
      signal: AbortSignal.timeout(ORDER_CREATE_TIMEOUT_MS),
    });
  } catch {
    throw new AppError("dependency_failed", "Could not reach Razorpay.");
  }

  if (!res.ok) {
    throw new AppError("dependency_failed", "Razorpay order creation failed.");
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AppError("dependency_failed", "Razorpay returned a malformed response.");
  }

  const parsed = RazorpayOrderResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("dependency_failed", "Razorpay returned a malformed response.");
  }

  return { orderId: parsed.data.id };
}

// Never throws (rulings: "Webhook" — bad/missing signature is a 400, not a
// 500). `createHmac`/`timingSafeEqual` on mismatched-length buffers would
// throw, so length is checked before the constant-time compare.
export function verifyRazorpaySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;

  try {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const actualBuf = Buffer.from(signature, "hex");
    if (expectedBuf.length !== actualBuf.length || expectedBuf.length === 0) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  } catch {
    return false;
  }
}

// Non-strict: Razorpay's real payload carries more fields than this; only
// what T11/T12 need to read is modeled. `payload.payment.entity.method` is
// Razorpay's raw method ("upi", "card", "netbanking", "wallet", ...), mapped
// to the three `payments.mode` values inside `record_online_payment` (SQL).
export const RazorpayWebhookSchema = z.object({
  event: z.string(),
  payload: z.object({
    payment: z
      .object({
        entity: z.object({
          id: z.string(),
          order_id: z.string(),
          status: z.string(),
          amount: z.number().int().nonnegative(),
          currency: z.string(),
          method: z.string().optional(),
        }),
      })
      .optional(),
    order: z
      .object({
        entity: z.object({
          id: z.string(),
        }),
      })
      .optional(),
  }),
});

export type RazorpayWebhook = z.infer<typeof RazorpayWebhookSchema>;
