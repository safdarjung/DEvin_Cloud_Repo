// T-038 — channel adapters. `send` never calls the network for the two
// simulated channels (security requirement: a unit test asserts no `fetch`);
// `in_app` never needs a network call either since it is the DB row itself.
import type { NotificationChannel } from "../templates.ts";

export interface DeliveryAttemptDraft {
  toAddress: string | null;
  renderedBody: string;
}

export interface DeliveryResult {
  status: "sent" | "simulated" | "failed";
  provider?: string | null;
  providerRef?: string | null;
  error?: string | null;
}

export interface Channel {
  name: NotificationChannel;
  send(attempt: DeliveryAttemptDraft): Promise<DeliveryResult>;
}
