"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useTheme } from "next-themes";
import { Bell, LogOut, Monitor, Moon, Sun, Users } from "lucide-react";
import { demoLogin } from "@/app/(auth)/login/actions";
import { DEMO_ACCOUNTS } from "@/lib/auth/demo-accounts";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
}: {
  name: string;
  email?: string;
  role: Role;
  /** Omitted when the caller lacks `notification.read`. */
  notificationsHref?: string;
  /** Demo tenants only: shows the role switcher. */
  isDemo?: boolean;
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
        className="flex min-h-10 min-w-10 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar>
          <AvatarFallback className="text-xs font-medium">{initials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <div className="space-y-1 px-1.5 py-1.5">
          <p className="truncate text-sm font-medium">{name}</p>
          {email && <p className="truncate text-xs text-muted-foreground">{email}</p>}
          <RoleBadge role={role} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light" className={item}>
            <Sun aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark" className={item}>
            <Moon aria-hidden /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system" className={item}>
            <Monitor aria-hidden /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {isDemo && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className={item} disabled={switching}>
                <Users aria-hidden /> {switching ? "Switching…" : "Switch demo role"}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                <DropdownMenuRadioGroup value={email ?? ""} onValueChange={switchTo}>
                  {DEMO_ACCOUNTS.map((a) => (
                    <DropdownMenuRadioItem key={a.email} value={a.email} className={item}>
                      {a.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
        <DropdownMenuSeparator />
        {notificationsHref && (
          <DropdownMenuItem asChild className={item}>
            <Link href={notificationsHref}>
              <Bell aria-hidden /> Notifications
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
