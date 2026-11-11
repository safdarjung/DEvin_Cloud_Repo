import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { FadeIn } from "@/components/motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarList, type VizTone } from "@/components/widgets/viz";
import { humanize } from "@/lib/format";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { MessageLog } from "@/modules/notifications/components/MessageLog";
import { listDeliveryLog } from "@/modules/notifications/queries";

export const metadata: Metadata = { title: "Notification log" };

const STATUS_TONE: Record<string, VizTone> = { sent: "success", queued: "warning", failed: "destructive" };

export default async function NotificationLogPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "notification.log.read");

  const rows = await listDeliveryLog(ctx);

  // Counts derived from the rows already loaded for the table below.
  const byStatus = new Map<string, number>();
  for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  const statusBars = [...byStatus.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([status, value]) => ({ label: humanize(status), value, tone: STATUS_TONE[status] ?? "default" }));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Message log"
        description="Every delivery attempt for this institution. SMS and email are simulated — no real provider is ever called."
        back={{ href: `/${institutionSlug}/notifications`, label: "Notifications" }}
      />

      {statusBars.length > 0 && (
        <FadeIn>
          <Card size="sm">
            <CardHeader>
              <CardTitle>Attempts by status</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0">
              <BarList items={statusBars} ariaLabel="Delivery attempts by status" />
            </CardContent>
          </Card>
        </FadeIn>
      )}

      <Card>
        <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
          <MessageLog rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
