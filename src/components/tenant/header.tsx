import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/tenant/role-badge";
import { MobileNav, type NavLinkItem } from "@/components/tenant/sidebar";
import type { Role } from "@/lib/auth/permissions";
import { Bell } from "@/modules/notifications/components/Bell";

export function TenantHeader({
  institutionName,
  role,
  navItems,
  notificationsHref,
  unreadCount,
}: {
  institutionName: string;
  role: Role;
  navItems: NavLinkItem[];
  /** Omitted entirely when the caller lacks `notification.read` (rare — granted to every role). */
  notificationsHref?: string;
  unreadCount?: number;
}) {
  return (
    <header className="sticky top-0 z-(--z-header) flex h-14 items-center justify-between gap-2 border-b bg-background px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <MobileNav items={navItems} />
        <span className="truncate font-semibold">{institutionName}</span>
        <RoleBadge role={role} />
      </div>
      <div className="flex shrink-0 items-center gap-1 sm:gap-2">
        {notificationsHref && <Bell href={notificationsHref} unreadCount={unreadCount ?? 0} />}
        <form action="/logout" method="post">
          <Button type="submit" variant="ghost" className="h-10 px-2.5 sm:px-3" aria-label="Log out">
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Log out</span>
          </Button>
        </form>
      </div>
    </header>
  );
}
