import { cookies } from "next/headers";
import { Banknote, CalendarCheck, FilePlus, GraduationCap, UserPlus } from "lucide-react";
import type { QuickAction } from "@/components/tenant/command-palette";
import { DemoBanner } from "@/components/tenant/demo-banner";
import { TenantHeader } from "@/components/tenant/header";
import { SIDEBAR_COOKIE, TenantSidebar } from "@/components/tenant/sidebar";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { navItemsFor } from "@/lib/nav";
import { getClaims } from "@/lib/supabase/server";
import { startOfToday } from "@/modules/fabric/components/fabric-page";
import { FabricProvider } from "@/modules/fabric/components/fabric-provider";
import { fabricSeed } from "@/modules/fabric/components/fabric-seed";
import {
  listMyNotifications,
  unreadCount as unreadNotificationCount,
  type NotificationSummary,
} from "@/modules/notifications/queries";

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
  let notifications: NotificationSummary[] = [];
  if (hasNotifications) {
    try {
      [unread, notifications] = await Promise.all([unreadNotificationCount(ctx), listMyNotifications(ctx, 5)]);
    } catch (err) {
      const correlationId = crypto.randomUUID();
      console.error(`[${correlationId}] header notifications failed`, err);
    }
  }

  const navItems = navItemsFor(ctx.permissions).map(({ href, label, icon: Icon, group }) => ({
    href: `/${ctx.institution.slug}${href}`,
    label,
    icon: <Icon className="size-4 shrink-0" aria-hidden />,
    group,
  }));

  // Portal users (exam.recheck.request) get no staff shortcuts or student search.
  const isPortalUser = hasPermission(ctx, "exam.recheck.request");
  const base = `/${ctx.institution.slug}`;
  const icon = "size-4 shrink-0";
  const quickActions: QuickAction[] = isPortalUser
    ? []
    : ([
        hasPermission(ctx, "admissions.enquiry.write") && {
          href: `${base}/admissions`,
          label: "New enquiry",
          icon: <UserPlus className={icon} aria-hidden />,
        },
        hasPermission(ctx, "finance.payment.record") && {
          href: `${base}/finance/invoices`,
          label: "Record payment",
          icon: <Banknote className={icon} aria-hidden />,
        },
        hasPermission(ctx, "attendance.mark") && {
          href: `${base}${hasPermission(ctx, "dashboard.view") ? "/attendance" : "/today"}`,
          label: "Mark attendance",
          icon: <CalendarCheck className={icon} aria-hidden />,
        },
        hasPermission(ctx, "assignment.manage") && {
          href: `${base}/assignments/new`,
          label: "New assignment",
          icon: <FilePlus className={icon} aria-hidden />,
        },
        hasPermission(ctx, "exam.manage") && {
          href: `${base}/exams/new`,
          label: "New exam",
          icon: <GraduationCap className={icon} aria-hidden />,
        },
      ] satisfies (QuickAction | false)[]).filter((a) => a !== false);

  // Email lives only in the JWT claims (not in TenantContext); it's the caller's own.
  const claims = await getClaims();
  const userEmail = typeof claims?.email === "string" ? claims.email : undefined;
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
        institutionSlug={ctx.institution.slug}
        institutionName={ctx.institution.name}
        role={ctx.membership.role}
        userName={ctx.user.profile.fullName ?? userEmail ?? "Account"}
        userEmail={userEmail}
        isDemo={ctx.institution.is_demo}
        navItems={navItems}
        quickActions={quickActions}
        canSearchStudents={!isPortalUser && hasPermission(ctx, "student.read")}
        notificationsHref={hasNotifications ? `/${ctx.institution.slug}/notifications` : undefined}
        unreadCount={unread}
        notifications={notifications}
      />
      <div className="flex flex-1">
        <TenantSidebar items={navItems} defaultCollapsed={sidebarCollapsed} />
        <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <FabricProvider seed={fabricSeed({ now: startOfToday(), institutionId: ctx.institution.id }, ctx.user.id)}>
              {children}
            </FabricProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
