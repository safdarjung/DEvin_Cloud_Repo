import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/tenant/role-badge";
import type { Role } from "@/lib/auth/permissions";
import { Bell } from "@/modules/notifications/components/Bell";

export function TenantHeader({
  institutionName,
  role,
  notificationsHref,
  unreadCount,
}: {
  institutionName: string;
  role: Role;
  /** Omitted entirely when the caller lacks `notification.read` (rare — granted to every role). */
  notificationsHref?: string;
  unreadCount?: number;
}) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-semibold">{institutionName}</span>
        <RoleBadge role={role} />
      </div>
      <div className="flex items-center gap-2">
        {notificationsHref && <Bell href={notificationsHref} unreadCount={unreadCount ?? 0} />}
        <form action="/logout" method="post">
          <Button type="submit" variant="ghost" size="sm">
            <LogOut className="size-4" />
            Log out
          </Button>
        </form>
      </div>
    </header>
  );
}
