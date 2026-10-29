import Link from "next/link";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { Inbox } from "@/modules/notifications/components/Inbox";
import { listMyNotifications } from "@/modules/notifications/queries";

export default async function NotificationsPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "notification.read");

  const notifications = await listMyNotifications(ctx);
  const canReadLog = ctx.permissions.has("notification.log.read");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-muted-foreground text-sm">In-app notifications addressed to you.</p>
        </div>
        {canReadLog && (
          <Link href={`/${institutionSlug}/notifications/log`} className="text-sm underline">
            Message log
          </Link>
        )}
      </div>

      <Inbox institutionSlug={institutionSlug} notifications={notifications} />
    </div>
  );
}
