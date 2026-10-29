import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/tenant/role-badge";
import type { Role } from "@/lib/auth/permissions";

export function TenantHeader({
  institutionName,
  role,
}: {
  institutionName: string;
  role: Role;
}) {
  return (
    <header className="flex items-center justify-between border-b px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="font-semibold">{institutionName}</span>
        <RoleBadge role={role} />
      </div>
      <form action="/logout" method="post">
        <Button type="submit" variant="ghost" size="sm">
          <LogOut className="size-4" />
          Log out
        </Button>
      </form>
    </header>
  );
}
