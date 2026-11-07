"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Search, SunMoon, Users } from "lucide-react";
import type { NavLinkItem } from "@/components/tenant/sidebar";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export interface QuickAction {
  href: string;
  label: string;
  icon: ReactNode;
}

// Navigation only (router.push / theme toggle): the palette never calls
// actions, and everything listed is computed server-side from the member's
// permissions (layout.tsx). The student search just lands on the permission-
// guarded students page; the typed text never leaves the browser until then.
// Extra search terms for nav items whose label isn't how people say it.
const NAV_SYNONYMS: Record<string, string[]> = {
  "Digital twin": ["twin", "model", "replica"],
  "Custom Studio": ["studio", "custom module", "build"],
  "AI workforce": ["agents", "automation"],
  Simulator: ["scenario", "what if"],
  Marketplace: ["modules", "install", "store"],
};

export function CommandPalette({
  institutionSlug,
  navItems,
  quickActions,
  canSearchStudents,
}: {
  institutionSlug: string;
  navItems: NavLinkItem[];
  quickActions: QuickAction[];
  canSearchStudents: boolean;
}) {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const isMac = useSyncExternalStore(
    () => () => {},
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
  const shortcut = isMac ? "⌘K" : "Ctrl K";

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  function run(fn: () => void) {
    onOpenChange(false);
    fn();
  }

  const term = query.trim();
  const showStudentSearch = canSearchStudents && term.length >= 2;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="size-10 px-0 text-muted-foreground sm:h-8 sm:w-56 sm:justify-start sm:gap-2 sm:border-input sm:px-3 sm:font-normal lg:w-72"
      >
        <Search className="size-4" aria-hidden />
        <span className="hidden flex-1 text-left sm:inline">Search…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[0.7rem] sm:inline">{shortcut}</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={onOpenChange}>
        <Command>
          <CommandInput placeholder="Search pages and actions…" value={query} onValueChange={setQuery} />
          <CommandList>
            {!showStudentSearch && <CommandEmpty>No results found.</CommandEmpty>}
            {showStudentSearch && (
              <>
                <CommandGroup heading="Search">
                  <CommandItem
                    forceMount
                    value={`search-students ${term}`}
                    onSelect={() =>
                      run(() => router.push(`/${institutionSlug}/students?q=${encodeURIComponent(term)}`))
                    }
                  >
                    <Users aria-hidden />
                    <span className="truncate">Search students for &lsquo;{term}&rsquo;</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="Navigate">
              {navItems.map((item) => (
                <CommandItem key={item.href} value={item.label} keywords={NAV_SYNONYMS[item.label]} onSelect={() => run(() => router.push(item.href))}>
                  {item.icon}
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {quickActions.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading="Quick actions">
                  {quickActions.map((action) => (
                    <CommandItem
                      key={action.label}
                      value={action.label}
                      onSelect={() => run(() => router.push(action.href))}
                    >
                      {action.icon}
                      {action.label}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
            <CommandSeparator />
            <CommandGroup heading="Preferences">
              <CommandItem
                value="Toggle theme"
                keywords={["dark", "light", "mode"]}
                onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}
              >
                <SunMoon aria-hidden />
                Toggle theme
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
