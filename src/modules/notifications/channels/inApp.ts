import type { Channel } from "./types.ts";

// In-app delivery is just the `notifications` row itself; this adapter only
// records a `delivery_attempts` entry so every channel has a uniform audit
// trail. Never contacts a network.
export const inApp: Channel = {
  name: "in_app",
  async send() {
    return { status: "sent" };
  },
};
