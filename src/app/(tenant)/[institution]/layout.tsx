import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { Banknote, CalendarCheck, FilePlus, GraduationCap, UserPlus } from "lucide-react";
import type { QuickAction } from "@/components/tenant/command-palette";
import { BellLoader } from "@/components/tenant/bell-loader";
import { Bell } from "@/modules/notifications/components/Bell";
import { AskAiLauncher } from "@/components/ask-ai-launcher";
import { ShellExtras } from "@/components/shell/shell-extras";
import { BottomNav } from "@/components/tenant/bottom-nav";
import { ROLE_LABELS } from "@/components/tenant/role-badge";
import { TenantHeader } from "@/components/tenant/header";
import { SIDEBAR_COOKIE, TenantSidebar, type SidebarUser } from "@/components/tenant/sidebar";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/require";
import { navItemsFor } from "@/lib/nav";
import { AppTour } from "@/components/tenant/app-tour";
import { buildTourSteps, tourStorageKey } from "@/lib/tour";
import { ROLE_INTRO, TOUR_COPY } from "@/lib/tour-copy";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { starterPromptsFor } from "@/modules/ai/page-starters";
import { practiceOptionsFor } from "@/modules/core/practice/scenarios";
import { getClaims } from "@/lib/supabase/server";
import { brandingStyle } from "@/modules/core/setup/branding-utils";
import { getLayoutBranding } from "@/modules/core/setup/branding.queries";
import { listEnabledTasks } from "@/modules/ai/tasks/state";
import { TrialBanner } from "@/modules/core/setup/components/TrialBanner";
import { TeachingProfileBanner } from "@/modules/people/components/TeachingProfileBanner";
import { getMyTeacherProfile } from "@/modules/people/queries";

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
  // F18 §H: school branding (validated colour as CSS variables, logo via signed URL); default theme when unset.
  const branding = await getLayoutBranding(ctx);
  // 0155: a teacher who has not saved their teaching profile sees a reminder until they do. A failed read
  // only hides the reminder; it never breaks the page.
  const profilePending =
    ctx.membership.role === "teacher" && Boolean(ctx.membership.staffId) && (await getMyTeacherProfile(ctx).then((p) => p !== null && p.onboardedAt === null, () => false));
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  return (
    <div className="flex min-h-screen flex-col" style={brandingStyle(branding.primaryColor)}>
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
            logoUrl={branding.logoUrl ?? undefined}
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
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 pb-[calc(9rem+env(safe-area-inset-bottom))] outline-none sm:px-6 lg:px-8 lg:pb-24">
            <div className="mx-auto w-full max-w-7xl">
              {!ctx.institution.is_demo && hasPermission(ctx, "institution.settings.manage") && <TrialBanner createdAt={ctx.institution.created_at} />}
              {profilePending && <TeachingProfileBanner href={`${base}/me/teaching-profile`} />}
              {children}
            </div>
          </main>
        </div>
      </div>
      <BottomNav items={navItems} user={sidebarUser} />
      <ShellExtras institutionSlug={ctx.institution.slug} />
      <AppTour
        steps={buildTourSteps(navItems, base, ctx.membership.role, TOUR_COPY).map((s) => {
          const tab = s.href.slice(base.length);
          const ask = starterPromptsFor(tab, ctx.membership.role)[0];
          return {
            ...s,
            // Only a question written for this page; the role's general starters would not match the tab.
            ask: ask === starterPromptsFor("/-", ctx.membership.role)[0] ? undefined : ask,
            practice: practiceOptionsFor(tab, {
              isDemo: ctx.institution.is_demo,
              has: (p) => hasPermission(ctx, p),
              moduleOn: (m) => isModuleEnabled(ctx, m),
            }),
          };
        })}
        orbHref={navItems.some((i) => i.href === `${base}/orb`) ? `${base}/orb` : null}
        institutionSlug={ctx.institution.slug}
        intro={ROLE_INTRO[ctx.membership.role]}
        roleLabel={ROLE_LABELS[ctx.membership.role]}
        storageKey={tourStorageKey(ctx.user.id, ctx.institution.id)}
      />
      <AskAiLauncher
        institutionSlug={ctx.institution.slug}
        role={ctx.membership.role}
        jumpItems={navItems.map(({ href, label, group }) => ({ href, label, group }))}
        tasks={launcherTasks(ctx)}
      />
    </div>
  );
}

/** The launcher's "On this page you can…" deep links; the orb page re-checks each task on arrival. */
function launcherTasks(ctx: Awaited<ReturnType<typeof getTenantContext>>) {
  try {
    return listEnabledTasks(ctx).map(({ action, label, mode, groupId }) => ({ action, label, mode, groupId }));
  } catch (e) {
    console.error("launcher: enabled tasks failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
