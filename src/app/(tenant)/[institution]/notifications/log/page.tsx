import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { MessageLog } from "@/modules/notifications/components/MessageLog";
import { listDeliveryLog } from "@/modules/notifications/queries";

export default async function NotificationLogPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "notification.log.read");

  const rows = await listDeliveryLog(ctx);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Message log</h1>
        <p className="text-muted-foreground text-sm">
          Every delivery attempt for this institution. SMS and email are simulated — no real provider is ever
          called.
        </p>
      </div>

      <MessageLog rows={rows} />
    </div>
  );
}
