import { cookies } from "next/headers";
import { DemoBanner } from "@/components/tenant/demo-banner";
import { TenantHeader } from "@/components/tenant/header";
import { SIDEBAR_COOKIE, TenantSidebar } from "@/components/tenant/sidebar";
import { getTenantContext } from "@/lib/auth/context";
import { navItemsFor } from "@/lib/nav";
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

  const navItems = navItemsFor(ctx.permissions).map(({ href, label, icon: Icon }) => ({
    href: `/${ctx.institution.slug}${href}`,
    label,
    icon: <Icon className="size-4 shrink-0" aria-hidden />,
  }));
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-toast) focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      {ctx.institution.is_demo && <DemoBanner />}
      <TenantHeader
        institutionName={ctx.institution.name}
        role={ctx.membership.role}
        navItems={navItems}
        notificationsHref={hasNotifications ? `/${ctx.institution.slug}/notifications` : undefined}
        unreadCount={unread}
      />
      <div className="flex flex-1">
        <TenantSidebar items={navItems} defaultCollapsed={sidebarCollapsed} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
