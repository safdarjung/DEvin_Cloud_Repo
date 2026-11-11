import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { Inbox } from "@/modules/notifications/components/Inbox";
import { listMyNotifications } from "@/modules/notifications/queries";

export const metadata: Metadata = { title: "Notifications" };

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
      <PageHeader
        title="Notifications"
        description="In-app notifications addressed to you."
        actions={
          canReadLog && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/${institutionSlug}/notifications/log`}>Message log</Link>
            </Button>
          )
        }
      />

      <FadeIn>
        <Card>
          <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
            <Inbox institutionSlug={institutionSlug} notifications={notifications} />
          </CardContent>
        </Card>
      </FadeIn>
    </div>
  );
}
