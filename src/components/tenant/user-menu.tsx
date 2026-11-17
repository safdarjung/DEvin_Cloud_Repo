"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useTheme } from "next-themes";
import { Bell, ChevronDown, Compass, ListChecks, LogOut, Moon, ShieldCheck, Sun, Users } from "lucide-react";
import { demoLogin } from "@/app/(auth)/login/actions";
import { SWITCH_ROLE_ACCOUNTS } from "@/lib/auth/demo-accounts";
import { DEMO_QUICK_LOGIN } from "@/lib/auth/demo-flag";
import { TOUR_START_EVENT } from "@/lib/tour";
import { RoleBadge } from "@/components/tenant/role-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Role } from "@/lib/auth/permissions";

const item = "min-h-10 sm:min-h-8";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

export function UserMenu({
  name,
  email,
  role,
  notificationsHref,
  isDemo,
  isPlatformAdmin,
}: {
  name: string;
  email?: string;
  role: Role;
  /** Omitted when the caller lacks `notification.read`. */
  notificationsHref?: string;
  /** Demo tenants only: shows the role switcher. */
  isDemo?: boolean;
  /** Shows the "Platform console" link (/platform). */
  isPlatformAdmin?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const [switching, startSwitch] = useTransition();

  // Same server action as the login page's one-tap buttons; it redirects to the new role's home.
  function switchTo(nextEmail: string) {
    if (nextEmail === email) return;
    const fd = new FormData();
    fd.set("email", nextEmail);
    startSwitch(() => {
      void demoLogin(null, fd);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring md:pr-2"
      >
        <Avatar>
          <AvatarFallback className="text-xs font-medium">{initials(name)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-32 truncate text-sm font-medium md:inline">{name}</span>
        <ChevronDown className="hidden size-3.5 text-muted-foreground md:inline" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[min(80dvh,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto">
        <div className="space-y-1 px-1.5 py-1.5">
          <p className="truncate text-sm font-medium">{name}</p>
          {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
          <RoleBadge role={role} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "light"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className={item}>
            <Sun aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className={item}>
            <Moon aria-hidden /> Dark
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {isDemo && DEMO_QUICK_LOGIN && (
          <>
            <DropdownMenuSeparator />
            {/* Inline, not a side submenu: on a phone the submenu opened off the screen. */}
            <DropdownMenuLabel className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Users aria-hidden className="size-3.5" /> {switching ? "Switching…" : "Switch role"}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup value={email ?? ""} onValueChange={switchTo}>
              {SWITCH_ROLE_ACCOUNTS.map((a) => (
                <DropdownMenuRadioItem key={a.email} value={a.email} className={item} disabled={switching}>
                  {a.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={item} onSelect={() => window.dispatchEvent(new Event(TOUR_START_EVENT))}>
          <Compass aria-hidden /> Take the tour
        </DropdownMenuItem>
        <DropdownMenuItem className={item} onSelect={() => window.dispatchEvent(new CustomEvent(TOUR_START_EVENT, { detail: "pick" }))}>
          <ListChecks aria-hidden /> Try one feature
        </DropdownMenuItem>
        {notificationsHref && (
          <DropdownMenuItem asChild className={item}>
            <Link href={notificationsHref}>
              <Bell aria-hidden /> Notifications
            </Link>
          </DropdownMenuItem>
        )}
        {isPlatformAdmin && (
          <DropdownMenuItem asChild className={item}>
            <Link href="/platform">
              <ShieldCheck aria-hidden /> Platform console
            </Link>
          </DropdownMenuItem>
        )}
        <form action="/logout" method="post">
          {/* preventDefault keeps the menu mounted so the native submit isn't racing the unmount. */}
          <DropdownMenuItem asChild className={item} onSelect={(e) => e.preventDefault()}>
            <button type="submit" className="w-full">
              <LogOut aria-hidden /> Log out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
