// M02-T6 — read-only wrappers for ./queries.ts, exposed at
// /api/v1/query/notifications.<fn>. defineQuery adds Zod input validation +
// a permission gate; RLS stays the actual data filter.
import { defineQuery } from "@/lib/actions/define-query";
import { z } from "zod";
import { listDeliveryLog, listMyNotifications, unreadCount } from "./queries";

// permission: notification.read — notifications/page.tsx:17,
// portal/notifications/page.tsx:22, today/page.tsx and portal/page.tsx's
// conditioned calls all gate on this.
export const listMyNotificationsQuery = defineQuery({
  name: "notifications.listMyNotifications",
  module: "notifications",
  schema: z.object({ limit: z.number().int().positive().max(200).optional() }).strict(),
  permission: "notification.read",
  handler: (input, ctx) => listMyNotifications(ctx, input.limit),
});

// permission: notification.read — module default; no page caller today
// (the fn itself has no permission narrowing beyond RLS's own-row scope).
export const unreadCountQuery = defineQuery({
  name: "notifications.unreadCount",
  module: "notifications",
  schema: z.object({}).strict(),
  permission: "notification.read",
  handler: (_input, ctx) => unreadCount(ctx),
});

// permission: notification.log.read — notifications/log/page.tsx:15 and
// core's getDashboardData (canReadActivity) both gate on this; the fn
// itself also enforces it internally (defense in depth).
export const listDeliveryLogQuery = defineQuery({
  name: "notifications.listDeliveryLog",
  module: "notifications",
  schema: z.object({ limit: z.number().int().positive().max(500).optional() }).strict(),
  permission: "notification.log.read",
  handler: (input, ctx) => listDeliveryLog(ctx, input.limit),
});
