import type { Channel } from "./types.ts";

// Same contract as simulatedSms.ts: no email provider exists, so the
// message is only rendered and recorded, never sent over the network.
export const simulatedEmail: Channel = {
  name: "email",
  async send(attempt) {
    if (!attempt.toAddress) {
      return { status: "failed", error: "no_contact" };
    }
    return { status: "simulated", provider: "simulated-email" };
  },
};
