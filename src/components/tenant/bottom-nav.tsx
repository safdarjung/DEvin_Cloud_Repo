"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ellipsis } from "lucide-react";
import { MobileNav, useStudentHref, type NavLinkItem, type SidebarUser } from "@/components/tenant/sidebar";
import { activeNavHref, selectBottomNav } from "@/lib/bottom-nav";
import { cn } from "cn";

const tab =
  "flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium outline-none transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Mobile-only (below lg) thumb nav over the same permission-filtered items as the sidebar. */
export function BottomNav({ items, user }: { items: NavLinkItem[]; user: SidebarUser }) {
  const pathname = usePathname();
  const withStudent = useStudentHref();
  const { primary, hasMore } = selectBottomNav(items);
  if (primary.length === 0) return null;
  const activeHref = activeNavHref(pathname, primary.map((i) => i.href));

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-(--z-header) border-t border-topbar-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-card/80 lg:hidden"
    >
      <ul className="flex">
        {primary.map((item) => {
          const active = item.href === activeHref;
          return (
            <li key={item.href} className="flex min-w-0 flex-1">
              <Link
                href={withStudent(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(tab, active ? "text-primary" : "text-muted-foreground hover:text-foreground")}
              >
                {item.icon}
                <span className="max-w-full truncate">{item.label}</span>
              </Link>
            </li>
          );
        })}
        {hasMore && (
          <li className="flex min-w-0 flex-1">
            <MobileNav
              items={items}
              user={user}
              trigger={
                <button type="button" aria-label="More navigation" className={cn(tab, "text-muted-foreground hover:text-foreground")}>
                  <Ellipsis className="size-4 shrink-0" aria-hidden />
                  <span>More</span>
                </button>
              }
            />
          </li>
        )}
      </ul>
    </nav>
  );
}
