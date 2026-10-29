import Link from "next/link";
import { navItemsFor } from "@/lib/nav";
import type { Permission } from "@/lib/auth/permissions";

export function TenantSidebar({
  basePath,
  permissions,
}: {
  basePath: string;
  permissions: ReadonlySet<Permission>;
}) {
  const items = navItemsFor(permissions);

  return (
    <nav aria-label="Primary" className="flex w-56 flex-col gap-1 border-r p-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={`${basePath}${item.href}`}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
