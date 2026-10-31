"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "cn";

// Icons arrive as rendered nodes: LucideIcon components can't cross the
// server -> client boundary as props (layout.tsx builds these from navItemsFor).
export interface NavLinkItem {
  href: string;
  label: string;
  icon: ReactNode;
}

export const SIDEBAR_COOKIE = "cs_sidebar";

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function NavLinks({
  items,
  collapsed = false,
  onNavigate,
}: {
  items: NavLinkItem[];
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // Longest matching href wins so /exams/rechecks doesn't also light up /exams.
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-(--duration-fast) ease-out",
                focusRing,
                collapsed && "justify-center px-0",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              {item.icon}
              <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <span className="text-lg font-semibold tracking-tight text-primary">
      {collapsed ? (
        <>
          <span aria-hidden>CS</span>
          <span className="sr-only">CoolSkool</span>
        </>
      ) : (
        "CoolSkool"
      )}
    </span>
  );
}

export function TenantSidebar({
  items,
  defaultCollapsed,
}: {
  items: NavLinkItem[];
  defaultCollapsed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Persistence is a convenience; the toggle still works for this session.
    }
  }

  return (
    <aside
      className={cn(
        "sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col gap-4 overflow-y-auto border-r bg-sidebar p-3 text-sidebar-foreground transition-[width] duration-(--duration-normal) ease-out lg:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className={cn("flex min-h-10 items-center px-3", collapsed && "justify-center px-0")}>
        <Wordmark collapsed={collapsed} />
      </div>
      <nav aria-label="Primary" className="flex-1">
        <NavLinks items={items} collapsed={collapsed} />
      </nav>
      <Button
        type="button"
        variant="ghost"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className={cn("h-10 justify-start gap-3 px-3 text-muted-foreground", collapsed && "justify-center px-0")}
      >
        {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        {!collapsed && <span className="text-sm font-medium">Collapse</span>}
      </Button>
    </aside>
  );
}

export function MobileNav({ items }: { items: NavLinkItem[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-10 lg:hidden" aria-label="Open menu">
          <Menu className="size-5" aria-hidden />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="gap-0 p-3">
        <div className="flex min-h-10 items-center px-3">
          <SheetTitle className="text-lg font-semibold tracking-tight text-primary">CoolSkool</SheetTitle>
          <SheetDescription className="sr-only">Site navigation</SheetDescription>
        </div>
        <nav aria-label="Primary" className="mt-4 overflow-y-auto">
          <NavLinks items={items} onNavigate={() => setOpen(false)} />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
