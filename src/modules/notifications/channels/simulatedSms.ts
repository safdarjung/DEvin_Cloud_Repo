import type { Channel } from "./types.ts";

// CLAUDE.md rule 7 / 06 §3 — SMS is simulated: no SMS gateway exists in this
// codebase, so the message is only rendered and recorded. Never calls
// `fetch` or any network API (asserted by tests/unit/notification-templates.test.ts).
export const simulatedSms: Channel = {
  name: "sms",
  async send(attempt) {
    if (!attempt.toAddress) {
      return { status: "failed", error: "no_contact" };
    }
    return { status: "simulated", provider: "simulated-sms" };
  },
};
