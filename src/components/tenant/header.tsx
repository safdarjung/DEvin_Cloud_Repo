import type { ReactNode } from "react";
import { CommandPalette, type QuickAction } from "@/components/tenant/command-palette";
import { HeaderCrumb } from "@/components/tenant/header-crumb";
import { RoleBadge } from "@/components/tenant/role-badge";
import { MobileNav, type NavLinkItem, type SidebarUser } from "@/components/tenant/sidebar";
import { UserMenu } from "@/components/tenant/user-menu";
import type { Role } from "@/lib/auth/permissions";

export function TenantHeader({
  institutionSlug,
  institutionName,
  role,
  userName,
  userEmail,
  isDemo,
  navItems,
  sidebarUser,
  isPlatformAdmin,
  quickActions,
  canSearchStudents,
  notificationsHref,
  bell,
}: {
  institutionSlug: string;
  institutionName: string;
  role: Role;
  userName: string;
  userEmail?: string;
  isDemo?: boolean;
  navItems: NavLinkItem[];
  sidebarUser: SidebarUser;
  /** Shows the "Platform console" menu item. */
  isPlatformAdmin?: boolean;
  quickActions: QuickAction[];
  canSearchStudents: boolean;
  /** Omitted entirely when the caller lacks `notification.read` (rare — granted to every role). */
  notificationsHref?: string;
  /** The notification bell (streamed by the layout); omitted without `notification.read`. */
  bell?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-(--z-header) flex h-14 items-center justify-between gap-2 border-b border-topbar-border bg-topbar px-3 sm:px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <MobileNav items={navItems} user={sidebarUser} />
        <HeaderCrumb institutionName={institutionName} />
        <span className="hidden md:inline-flex"><RoleBadge role={role} /></span>
        {isDemo && (
          <span className="hidden rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-foreground sm:inline">Demo mode · sample data</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <CommandPalette
          institutionSlug={institutionSlug}
          navItems={navItems}
          quickActions={quickActions}
          canSearchStudents={canSearchStudents}
        />
        {bell}
        <UserMenu name={userName} email={userEmail} role={role} notificationsHref={notificationsHref} isDemo={isDemo} isPlatformAdmin={isPlatformAdmin} />
      </div>
    </header>
  );
}
