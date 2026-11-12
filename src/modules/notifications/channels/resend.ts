// M17-T1 (D42) — Resend email adapter + emailChannel() selector. Plain-node
// file: loaded by `pnpm jobs:run` via service.ts — relative `.ts` imports
// only, no `@/` value imports, no `server-only` (same constraint as
// service.ts). Adapter never throws (rulings: "Result mapping").
import type { Channel, DeliveryAttemptDraft, DeliveryResult } from "./types.ts";
import { simulatedEmail } from "./simulatedEmail.ts";

const RESEND_URL = "https://api.resend.com/emails";
const MAX_RETRY_AFTER_SECONDS = 2;
const DEFAULT_RETRY_AFTER_SECONDS = 1;
const NETWORK_TIMEOUT_MS = 10_000;

// Read per call (never at module load) so tests can `vi.stubEnv` — rulings
// "One predicate". Nothing else reads this key.
export function resendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function emailChannel(): Channel {
  return resendConfigured() ? resendEmail : simulatedEmail;
}

// RFC 2606 / 6761 reserved test domains — demo tenant addresses
// (`@demo.coolskool.test`) and test fixtures must never hit a real provider.
const RESERVED_TLDS = [".test", ".example", ".invalid", ".localhost"];
const RESERVED_DOMAINS = ["example.com", "example.net", "example.org"];

function isReservedTestAddress(address: string): boolean {
  const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
  return RESERVED_TLDS.some((tld) => domain.endsWith(tld)) || RESERVED_DOMAINS.includes(domain);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postOnce(attempt: DeliveryAttemptDraft, toAddress: string): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
    "User-Agent": "coolskool",
  };
  if (attempt.idempotencyKey) {
    headers["Idempotency-Key"] = attempt.idempotencyKey;
  }
  return fetch(RESEND_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "FabricOS <onboarding@resend.dev>",
      to: [toAddress],
      subject: attempt.subject || "FabricOS",
      text: attempt.renderedBody,
    }),
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
}

async function resultFromResponse(res: Response): Promise<DeliveryResult> {
  if (res.ok) {
    const data = (await res.json()) as { id?: string };
    return { status: "sent", provider: "resend", providerRef: data.id ?? null };
  }
  return { status: "failed", provider: "resend", error: `resend_http_${res.status}` };
}

export const resendEmail: Channel = {
  name: "email",
  async send(attempt: DeliveryAttemptDraft): Promise<DeliveryResult> {
    if (!attempt.toAddress) {
      return { status: "failed", error: "no_contact" };
    }
    if (isReservedTestAddress(attempt.toAddress)) {
      return simulatedEmail.send(attempt);
    }

    try {
      const res = await postOnce(attempt, attempt.toAddress);
      if (res.status === 429) {
        const retryAfter = Math.min(
          Number(res.headers.get("Retry-After")) || DEFAULT_RETRY_AFTER_SECONDS,
          MAX_RETRY_AFTER_SECONDS,
        );
        await sleep(retryAfter * 1000);
        const retryRes = await postOnce(attempt, attempt.toAddress);
        return resultFromResponse(retryRes);
      }
      return resultFromResponse(res);
    } catch {
      // Never surface the caught error (may embed the address — lesson 10).
      return { status: "failed", error: "resend_network" };
    }
  },
};
