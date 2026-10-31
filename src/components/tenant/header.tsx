import type { ReactNode } from "react";
import { CommandPalette, type QuickAction } from "@/components/tenant/command-palette";
import { RoleBadge } from "@/components/tenant/role-badge";
import { MobileNav, type NavLinkItem } from "@/components/tenant/sidebar";
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
  quickActions: QuickAction[];
  canSearchStudents: boolean;
  /** Omitted entirely when the caller lacks `notification.read` (rare — granted to every role). */
  notificationsHref?: string;
  /** The notification bell (streamed by the layout); omitted without `notification.read`. */
  bell?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-(--z-header) flex h-14 items-center justify-between gap-2 border-b border-border/60 bg-background/90 px-3 backdrop-blur-md sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <MobileNav items={navItems} />
        <span className="hidden truncate font-semibold min-[400px]:inline">{institutionName}</span>
        <RoleBadge role={role} />
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        <CommandPalette
          institutionSlug={institutionSlug}
          navItems={navItems}
          quickActions={quickActions}
          canSearchStudents={canSearchStudents}
        />
        {bell}
        <UserMenu name={userName} email={userEmail} role={role} notificationsHref={notificationsHref} isDemo={isDemo} />
      </div>
    </header>
  );
}
