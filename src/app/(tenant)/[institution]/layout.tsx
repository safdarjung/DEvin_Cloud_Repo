import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { Banknote, CalendarCheck, FilePlus, GraduationCap, UserPlus } from "lucide-react";
import type { QuickAction } from "@/components/tenant/command-palette";
import { BellLoader } from "@/components/tenant/bell-loader";
import { Bell } from "@/modules/notifications/components/Bell";
import { AskAiLauncher } from "@/components/ask-ai-launcher";
import { BottomNav } from "@/components/tenant/bottom-nav";
import { ROLE_LABELS } from "@/components/tenant/role-badge";
import { TenantHeader } from "@/components/tenant/header";
import { SIDEBAR_COOKIE, TenantSidebar, type SidebarUser } from "@/components/tenant/sidebar";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { navItemsFor } from "@/lib/nav";
import { getClaims } from "@/lib/supabase/server";
import { startOfToday } from "@/modules/fabric/components/fabric-page";
import { FabricProvider } from "@/modules/fabric/components/fabric-provider";
import { fabricSeed } from "@/modules/fabric/components/fabric-seed";

export const metadata: Metadata = { robots: { index: false, follow: false } };

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
  const navItems = navItemsFor(ctx.permissions, ctx.institution.settings, ctx.institution.is_demo, ctx.membership.role).map(({ href, label, icon: Icon, group }) => ({
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
  const sidebarUser: SidebarUser = {
    name: ctx.user.profile.fullName ?? userEmail ?? "Account",
    roleLabel: ROLE_LABELS[ctx.membership.role],
    institutionName: ctx.institution.name,
    // Same permission /settings/modules requires.
    settingsHref: hasPermission(ctx, "institution.settings.manage") ? `${base}/settings/modules` : undefined,
  };
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-toast) focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <div className="flex flex-1">
        <TenantSidebar items={navItems} user={sidebarUser} defaultCollapsed={sidebarCollapsed} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TenantHeader
            institutionSlug={ctx.institution.slug}
            institutionName={ctx.institution.name}
            role={ctx.membership.role}
            userName={sidebarUser.name}
            userEmail={userEmail}
            isDemo={ctx.institution.is_demo}
            navItems={navItems}
            sidebarUser={sidebarUser}
            isPlatformAdmin={ctx.user.profile.isPlatformAdmin}
            quickActions={quickActions}
            canSearchStudents={!isPortalUser && hasPermission(ctx, "student.read")}
            notificationsHref={hasNotifications ? `/${ctx.institution.slug}/notifications` : undefined}
            bell={
              hasNotifications && (
                <Suspense
                  fallback={<Bell href={`/${ctx.institution.slug}/notifications`} unreadCount={0} institutionSlug={ctx.institution.slug} notifications={[]} />}
                >
                  <BellLoader ctx={ctx} href={`/${ctx.institution.slug}/notifications`} />
                </Suspense>
              )
            }
          />
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 pb-[calc(5rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-8 lg:pb-8">
            <div className="mx-auto w-full max-w-7xl">
              <FabricProvider seed={fabricSeed({ now: startOfToday(), institutionId: ctx.institution.id }, ctx.user.id)}>
                {children}
              </FabricProvider>
            </div>
          </main>
        </div>
      </div>
      <BottomNav items={navItems} user={sidebarUser} />
      <AskAiLauncher institutionSlug={ctx.institution.slug} />
    </div>
  );
}
