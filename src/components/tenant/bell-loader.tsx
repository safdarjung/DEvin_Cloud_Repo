import { Bell } from "@/modules/notifications/components/Bell";
import { listMyNotifications, unreadCount as unreadNotificationCount, type NotificationSummary } from "@/modules/notifications/queries";
import type { TenantContext } from "@/lib/auth/types";

/** Streamed behind <Suspense> so the bell's two queries never block the page. */
export async function BellLoader({ ctx, href }: { ctx: TenantContext; href: string }) {
  // A thrown count query must never crash every tenant page — the bell is a convenience.
  let unread = 0;
  let notifications: NotificationSummary[] = [];
  try {
    [unread, notifications] = await Promise.all([unreadNotificationCount(ctx), listMyNotifications(ctx, 5)]);
  } catch (err) {
    console.error(`[${crypto.randomUUID()}] header notifications failed`, err);
  }
  return <Bell href={href} unreadCount={unread} institutionSlug={ctx.institution.slug} notifications={notifications} />;
}
