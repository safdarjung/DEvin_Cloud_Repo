// Read-only wrappers over ./queries.ts, exposed at /api/v1/query/safety.<fn>.
import { defineQuery } from "@/lib/actions/define-query";
import { AlertIdSchema, AlertListSchema } from "./schemas";
import { listSafetyAlerts, safetyAlertSummary, safetyPendingAcknowledgements } from "./queries";

/** Alerts the caller can see (RLS = audience): active ones plus a page of closed history. Alert text, no person data. */
export const safetyAlertsQuery = defineQuery({
  name: "safety.alerts",
  module: "safety",
  schema: AlertListSchema,
  permission: "safety.alert.read",
  handler: (input, ctx) => listSafetyAlerts(ctx, input.page ?? 1),
});

/** Name-free aggregate: audience vs acknowledged counts by group, headcount totals, per-section board. */
export const safetyAlertSummaryQuery = defineQuery({
  name: "safety.alertSummary",
  module: "safety",
  schema: AlertIdSchema,
  permission: "safety.alert.send",
  handler: (input, ctx) => safetyAlertSummary(ctx, input.alertId),
});

/** Names of audience members who have not acknowledged (managers; holds person names — local only). */
export const safetyPendingQuery = defineQuery({
  name: "safety.pendingAcknowledgements",
  module: "safety",
  schema: AlertIdSchema,
  permission: "safety.alert.send",
  handler: (input, ctx) => safetyPendingAcknowledgements(ctx, input.alertId),
});
