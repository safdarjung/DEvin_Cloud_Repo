import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
      <PageHeader
        title="Message log"
        description="Every delivery attempt for this institution. SMS and email are simulated — no real provider is ever called."
        back={{ href: `/${institutionSlug}/notifications`, label: "Notifications" }}
      />

      <Card>
        <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
          <MessageLog rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
