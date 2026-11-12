"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";

// Icons arrive as rendered nodes: LucideIcon components can't cross the
// server -> client boundary as props (layout.tsx builds these from navItemsFor).
export interface NavLinkItem {
  href: string;
  label: string;
  icon: ReactNode;
  /** NavGroup from src/lib/nav.ts; items of one group arrive contiguously. */
  group: string;
}

/** Signed-in member details shown in the sidebar profile block and footer. */
export interface SidebarUser {
  name: string;
  roleLabel: string;
  institutionName: string;
  /** Present only when the member may open /settings/modules. */
  settingsHref?: string;
}

export const SIDEBAR_COOKIE = "cs_sidebar";

const PORTAL_HREF = /^\/[^/]+\/portal(\/|$)/;

/**
 * Portal pages scope every view to `?student=<id>`; carry the current value on
 * portal links so switching section never drops or changes the selected child.
 */
export function useStudentHref(): (href: string) => string {
  const student = useSearchParams().get("student");
  return (href) => (student && PORTAL_HREF.test(href) ? `${href}?student=${encodeURIComponent(student)}` : href);
}

const WIDTH_TRANSITION = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };

// Labels fade out before the width shrinks and in after it grows.
const labelFade = (collapsed: boolean, reduce: boolean | null) => ({
  animate: { opacity: collapsed ? 0 : 1 },
  transition: reduce ? { duration: 0 } : { duration: 0.1, delay: collapsed ? 0 : 0.1 },
});

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset";

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
  const withStudent = useStudentHref();
  // Longest matching href wins so /exams/rechecks doesn't also light up /exams.
  const activeHref = items
    .filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const sections: { group: string; items: NavLinkItem[] }[] = [];
  for (const item of items) {
    const last = sections[sections.length - 1];
    if (last?.group === item.group) last.items.push(item);
    else sections.push({ group: item.group, items: [item] });
  }

  return (
    <div className="flex flex-col">
      {sections.map((section, index) => (
        <div key={section.group} role="group" aria-label={section.group}>
          {/* Fixed height so collapsing swaps heading for divider without reflow. */}
          <div className="relative h-9">
            <motion.p
              initial={false}
              aria-hidden
              className="absolute inset-x-0 bottom-1.5 truncate pl-5 text-[11px] font-bold tracking-wide text-sidebar-muted uppercase"
              {...labelFade(collapsed, reduce)}
            >
              {section.group}
            </motion.p>
            {index > 0 && (
              <motion.hr
                initial={false}
                aria-hidden
                className="absolute inset-x-3 bottom-2 border-t border-sidebar-border"
                animate={{ opacity: collapsed ? 1 : 0 }}
                transition={labelFade(!collapsed, reduce).transition}
              />
            )}
          </div>
          <ul className="flex flex-col">
            {section.items.map((item) => {
              const active = item.href === activeHref;
              const link = (
                <Link
                  href={withStudent(item.href)}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    "flex h-11 lg:h-10 items-center gap-3 overflow-hidden border-r-4 pl-5 text-[13.5px] font-medium transition-colors duration-150",
                    focusRing,
                    active
                      ? "border-sidebar-primary bg-sidebar-accent text-white"
                      : "border-transparent text-sidebar-foreground hover:bg-sidebar-accent hover:text-white",
                  )}
                >
                  <span className={cn("grid size-[18px] shrink-0 place-items-center [&_svg]:size-[18px]", active && collapsed && "text-sidebar-primary")}>
                    {item.icon}
                  </span>
                  <motion.span initial={false} className="whitespace-nowrap" {...labelFade(collapsed, reduce)}>
                    {item.label}
                  </motion.span>
                </Link>
              );
              return (
                <li key={item.href}>
                  {collapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Product mark: an open book drawn as two pages meeting at the spine, in the data hue. */
function Mark() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="size-5 shrink-0 text-sidebar-primary">
      <path d="M10 5.2C8.4 4 6.2 3.5 3 3.6v11.2c3.2-.1 5.4.4 7 1.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M10 5.2c1.6-1.2 3.8-1.7 7-1.6v11.2c-3.2-.1-5.4.4-7 1.6V5.2Z" fill="currentColor" />
    </svg>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

function Brand({ collapsed, user }: { collapsed: boolean; user: SidebarUser }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex h-14 shrink-0 items-center gap-2.5 overflow-hidden border-b border-sidebar-border pl-5">
      <Mark />
      <motion.span initial={false} className="flex min-w-0 flex-col leading-tight whitespace-nowrap" {...labelFade(collapsed, reduce)}>
        <span className="text-[15px] font-semibold tracking-tight text-white">FabricOS</span>
        <span className="truncate text-[11px] text-sidebar-muted">{user.institutionName}</span>
      </motion.span>
    </div>
  );
}

function Profile({ collapsed, user }: { collapsed: boolean; user: SidebarUser }) {
  const reduce = useReducedMotion();
  if (collapsed) return null;
  return (
    <motion.div initial={false} className="flex shrink-0 items-center gap-3 overflow-hidden px-4 py-4" {...labelFade(collapsed, reduce)}>
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-full bg-sidebar-accent text-sm font-semibold text-white ring-2 ring-sidebar-border"
      >
        {initials(user.name)}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-xs text-sidebar-muted">Welcome,</span>
        <span className="truncate text-sm font-semibold text-white">{user.name}</span>
        <span className="truncate text-[11px] text-sidebar-muted">{user.roleLabel}</span>
      </span>
    </motion.div>
  );
}

const footerBtn =
  "grid h-10 place-items-center rounded-none text-sidebar-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-white " +
  focusRing;

function Footer({
  user,
  collapsed,
  onToggle,
  onNavigate,
}: {
  user: SidebarUser;
  collapsed: boolean;
  /** Omitted in the mobile drawer (no collapse there). */
  onToggle?: () => void;
  onNavigate?: () => void;
}) {
  const wrap = (label: string, node: ReactNode) => (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side={collapsed ? "right" : "top"}>{label}</TooltipContent>
    </Tooltip>
  );
  // Stacked when collapsed: each button keeps its height (flex-1 in a column shrank them to nothing, so they overlapped).
  const btn = cn(footerBtn, collapsed ? "w-full" : "flex-1");
  return (
    <div className={cn("flex shrink-0 bg-black/15", collapsed ? "flex-col" : "flex-row")}>
      {user.settingsHref &&
        wrap(
          "Settings",
          <Link href={user.settingsHref} onClick={onNavigate} aria-label="Settings" className={btn}>
            <Settings className="size-[18px]" aria-hidden />
          </Link>,
        )}
      {onToggle &&
        wrap(
          collapsed ? "Expand sidebar" : "Collapse sidebar",
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className={btn}
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" aria-hidden /> : <PanelLeftClose className="size-[18px]" aria-hidden />}
          </button>,
        )}
      <form action="/logout" method="post" className={collapsed ? "flex w-full" : "flex flex-1"}>
        {wrap(
          "Log out",
          <button type="submit" aria-label="Log out" className={cn(btn, "w-full")}>
            <LogOut className="size-[18px]" aria-hidden />
          </button>,
        )}
      </form>
    </div>
  );
}

export function TenantSidebar({
  items,
  user,
  defaultCollapsed,
}: {
  items: NavLinkItem[];
  user: SidebarUser;
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
      transition={reduce ? { duration: 0 } : WIDTH_TRANSITION}
      className="sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground lg:flex"
    >
      <TooltipProvider>
        <Brand collapsed={collapsed} user={user} />
        <Profile collapsed={collapsed} user={user} />
        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-3">
          <NavLinks items={items} collapsed={collapsed} />
        </nav>
        <Footer user={user} collapsed={collapsed} onToggle={toggle} />
      </TooltipProvider>
    </motion.aside>
  );
}

export function MobileNav({ items, user, trigger }: { items: NavLinkItem[]; user: SidebarUser; trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button type="button" variant="ghost" size="icon" className="size-11 lg:hidden" aria-label="Open menu">
            <Menu className="size-5" aria-hidden />
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="left" className="gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground [&>button]:text-sidebar-foreground">
        <SheetTitle className="sr-only">FabricOS</SheetTitle>
        <SheetDescription className="sr-only">Site navigation</SheetDescription>
        <TooltipProvider>
          <Brand collapsed={false} user={user} />
          <Profile collapsed={false} user={user} />
          <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto pb-3">
            <NavLinks items={items} onNavigate={close} />
          </nav>
          <Footer user={user} collapsed={false} onNavigate={close} />
        </TooltipProvider>
      </SheetContent>
    </Sheet>
  );
}
