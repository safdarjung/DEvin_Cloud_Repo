"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { MOTION } from "@/components/motion";
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

// Collapsing keeps icons at the same x (px-3 in a 40px inner width is already
// centred) and just clips labels, so nothing reflows or squishes. Labels fade
// out before the width shrinks and in after it grows.
const labelFade = (collapsed: boolean, reduce: boolean | null) => ({
  animate: { opacity: collapsed ? 0 : 1 },
  transition: reduce
    ? { duration: 0 }
    : { duration: MOTION.duration.fast * 0.67, delay: collapsed ? 0 : MOTION.duration.fast * 0.67 },
});

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
  const reduce = useReducedMotion();
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
                "flex min-h-10 items-center gap-3 overflow-hidden rounded-md px-3 text-sm font-medium transition-colors duration-(--duration-fast) ease-(--ease-out)",
                focusRing,
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              {item.icon}
              <motion.span initial={false} className="whitespace-nowrap" {...labelFade(collapsed, reduce)}>
                {item.label}
              </motion.span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Wordmark({ collapsed = false }: { collapsed?: boolean }) {
  const reduce = useReducedMotion();
  return (
    <span className="relative flex h-10 w-full items-center overflow-hidden text-lg font-semibold tracking-tight text-primary">
      <motion.span initial={false} className="whitespace-nowrap px-3" {...labelFade(collapsed, reduce)}>
        CoolSkool
      </motion.span>
      <motion.span
        initial={false}
        aria-hidden
        className="absolute inset-0 grid place-items-center"
        animate={{ opacity: collapsed ? 1 : 0 }}
        transition={labelFade(!collapsed, reduce).transition}
      >
        CS
      </motion.span>
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
  const reduce = useReducedMotion();

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
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 64 : 240 }}
      transition={reduce ? { duration: 0 } : { duration: MOTION.duration.normal, ease: MOTION.ease.out }}
      className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col gap-4 overflow-y-auto overflow-x-hidden border-r bg-sidebar p-3 text-sidebar-foreground lg:flex"
    >
      <div className="flex min-h-10 items-center">
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
        className="h-10 justify-start gap-3 overflow-hidden px-3 text-muted-foreground"
      >
        {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
        <motion.span initial={false} className="text-sm font-medium whitespace-nowrap" {...labelFade(collapsed, reduce)}>
          Collapse
        </motion.span>
      </Button>
    </motion.aside>
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
