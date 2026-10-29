import { DemoBanner } from "@/components/tenant/demo-banner";
import { TenantHeader } from "@/components/tenant/header";
import { TenantSidebar } from "@/components/tenant/sidebar";
import { getTenantContext } from "@/lib/auth/context";
import { unreadCount as unreadNotificationCount } from "@/modules/notifications/queries";

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  const hasNotifications = ctx.permissions.has("notification.read");
  // Fix round 1 (HIGH): a thrown unread-count query must never crash every
  // tenant page — the bell is a convenience, not a page dependency.
  let unread = 0;
  if (hasNotifications) {
    try {
      unread = await unreadNotificationCount(ctx);
    } catch (err) {
      const correlationId = crypto.randomUUID();
      console.error(`[${correlationId}] unread notification count failed`, err);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      {ctx.institution.is_demo && <DemoBanner />}
      <TenantHeader
        institutionName={ctx.institution.name}
        role={ctx.membership.role}
        notificationsHref={hasNotifications ? `/${ctx.institution.slug}/notifications` : undefined}
        unreadCount={unread}
      />
      <div className="flex flex-1">
        <TenantSidebar basePath={`/${ctx.institution.slug}`} permissions={ctx.permissions} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
