"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NAV, NAV_MORE } from "./content";
import { ThemeToggle } from "./theme-toggle";
import { ButtonLink } from "./ui";

export function Wordmark() {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2 rounded-md text-lg font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-(color:--mk-accent)">
      <span aria-hidden className="grid size-6 grid-cols-2 gap-px overflow-hidden rounded-sm">
        <i className="bg-(color:--mk-accent)" />
        <i className="bg-(color:--mk-accent)/50" />
        <i className="bg-(color:--mk-accent)/50" />
        <i className="bg-(color:--mk-accent)" />
      </span>
      Fabric
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const link = (href: string) =>
    cn(
      "inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors hover:text-(color:--mk-fg) focus-visible:outline-2 focus-visible:outline-(color:--mk-accent)",
      pathname === href ? "text-(color:--mk-fg)" : "text-(color:--mk-muted)",
    );
  return (
    <header className="sticky top-0 z-40 border-b border-(color:--mk-line) bg-(color:--mk-bg)/95 supports-backdrop-filter:backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Wordmark />
        <nav aria-label="Primary" className="ml-6 hidden items-center lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={link(n.href)} aria-current={pathname === n.href ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link href="/login?switch=1" className={cn(link("/login"), "hidden sm:inline-flex")}>
            Sign in
          </Link>
          <ButtonLink href="/demo" variant="secondary" className="hidden sm:inline-flex">
            Try a demo
          </ButtonLink>
          <ButtonLink href="/contact" className="hidden md:inline-flex">
            Book a Demo
          </ButtonLink>
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-md hover:bg-(color:--mk-surface) focus-visible:outline-2 focus-visible:outline-(color:--mk-accent) lg:hidden"
              >
                <Menu className="size-5" aria-hidden />
                <span className="sr-only">Open menu</span>
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="p-0">
              <SheetTitle className="px-5 pt-5 text-base font-semibold">Menu</SheetTitle>
              <nav aria-label="Mobile" className="flex flex-col px-3 pb-6">
                {[...NAV, ...NAV_MORE].map((n) => (
                  <SheetClose asChild key={n.href}>
                    <Link href={n.href} className="flex min-h-11 items-center rounded-md px-2 text-base font-medium hover:bg-muted" aria-current={pathname === n.href ? "page" : undefined}>
                      {n.label}
                    </Link>
                  </SheetClose>
                ))}
                <SheetClose asChild>
                  <ButtonLink href="/demo" className="mt-4">
                    Try a demo
                  </ButtonLink>
                </SheetClose>
                <SheetClose asChild>
                  <ButtonLink href="/login?switch=1" variant="secondary" className="mt-2">
                    Sign in
                  </ButtonLink>
                </SheetClose>
                <SheetClose asChild>
                  <ButtonLink href="/contact" variant="secondary" className="mt-2">
                    Book a Demo
                  </ButtonLink>
                </SheetClose>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
