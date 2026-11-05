// X05-T2 (D42) — MSG91 WhatsApp adapter + whatsappChannel() selector. Plain-node
// file: loaded by `pnpm jobs:run` via service.ts — relative `.ts` imports
// only, no `@/` value imports, no `server-only` (same constraint as
// service.ts). Adapter never throws (rulings: "Result mapping").
import type { Channel, DeliveryAttemptDraft, DeliveryResult } from "./types.ts";

const MSG91_URL = "https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/";
const NETWORK_TIMEOUT_MS = 10_000;

// Read per call (never at module load) so tests can `vi.stubEnv` — rulings
// "One predicate". A future SMS adapter can set MSG91_AUTH_KEY alone without
// turning WhatsApp live.
export function whatsappConfigured(): boolean {
  return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_WA_NUMBER);
}

export function whatsappChannel(): Channel {
  return whatsappConfigured() ? msg91WhatsApp : simulatedWhatsApp;
}

// Guardian phones are already `^[6-9][0-9]{9}$` (0004 check); staff phones
// are free text, so this also covers `0`-prefixed and `91`-prefixed forms.
export function toMsisdn(phone: string): string | null {
  const stripped = phone.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  if (/^[6-9]\d{9}$/.test(stripped)) return `91${stripped}`;
  if (/^0[6-9]\d{9}$/.test(stripped)) return `91${stripped.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(stripped)) return stripped;
  return null;
}

export const simulatedWhatsApp: Channel = {
  name: "whatsapp",
  async send(attempt: DeliveryAttemptDraft): Promise<DeliveryResult> {
    if (!attempt.toAddress) {
      return { status: "failed", error: "no_contact" };
    }
    return { status: "simulated", provider: "simulated-whatsapp" };
  },
};

export const msg91WhatsApp: Channel = {
  name: "whatsapp",
  async send(attempt: DeliveryAttemptDraft): Promise<DeliveryResult> {
    if (!attempt.toAddress) {
      return { status: "failed", error: "no_contact" };
    }
    const msisdn = toMsisdn(attempt.toAddress);
    if (!msisdn) {
      return { status: "failed", error: "invalid_phone" };
    }
    if (!attempt.template) {
      return { status: "failed", error: "no_template" };
    }

    const { name, lang, params } = attempt.template;
    const components: Record<string, { type: "text"; value: string }> = {};
    params.forEach((value, i) => {
      components[`body_${i + 1}`] = { type: "text", value };
    });

    const namespace = process.env.MSG91_WA_NAMESPACE;
    try {
      const res = await fetch(MSG91_URL, {
        method: "POST",
        headers: {
          authkey: process.env.MSG91_AUTH_KEY || "",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          integrated_number: process.env.MSG91_WA_NUMBER,
          content_type: "template",
          payload: {
            messaging_product: "whatsapp",
            type: "template",
            template: {
              name,
              language: { code: lang, policy: "deterministic" },
              ...(namespace ? { namespace } : {}),
              to_and_components: [{ to: [msisdn], components }],
            },
          },
        }),
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      });

      if (!res.ok) {
        return { status: "failed", provider: "msg91", error: `msg91_http_${res.status}` };
      }
      const data = (await res.json()) as { hasError?: boolean; request_id?: unknown };
      if (data.hasError === true) {
        return { status: "failed", provider: "msg91", error: "msg91_rejected" };
      }
      return {
        status: "sent",
        provider: "msg91",
        providerRef: typeof data.request_id === "string" ? data.request_id : null,
      };
    } catch {
      // Never surface the caught error (may embed the key or number — lesson 10).
      return { status: "failed", error: "msg91_network" };
    }
  },
};
