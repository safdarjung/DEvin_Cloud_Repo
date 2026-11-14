"use client";

import "@/components/fabricos/fabricos.css";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { cn } from "cn";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { BRAND, CTA, NAV } from "@/components/fabricos/content";
import { FabricGlyph } from "@/components/fabricos/fabric-glyph";

export function Wordmark() {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2.5 rounded-md text-[17px] font-semibold tracking-[-0.02em] text-(color:--fos-fg)">
      <FabricGlyph className="size-6" />
      {BRAND}
    </Link>
  );
}

function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > threshold);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, [threshold]);
  return scrolled;
}

export function SiteHeader() {
  const pathname = usePathname();
  const home = pathname === "/";
  const scrolled = useScrolled();
  // Over the home hero the header floats transparently; everywhere else, and
  // once the visitor scrolls, it gets a solid surface and a hairline.
  const solid = !home || scrolled;
  const isCurrent = (href: string) => (href.startsWith("/#") ? false : pathname === href);

  const link = (href: string) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full px-3 text-sm transition-colors hover:text-(color:--fos-fg)",
      isCurrent(href) ? "text-(color:--fos-fg)" : "text-(color:--fos-muted)",
    );

  return (
    <header
      data-solid={!home ? "opaque" : scrolled ? "blur" : "none"}
      className={cn(
        "fos fos-header sticky top-0 z-40 border-b transition-[background-color,border-color,backdrop-filter] duration-300",
        home && "-mb-16",
        solid ? "border-(color:--fos-line)" : "border-transparent",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center gap-2 px-5 sm:px-8">
        <Wordmark />
        <nav aria-label="Primary" className="ml-8 hidden items-center xl:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className={link(n.href)} aria-current={isCurrent(n.href) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <Link href={CTA.signIn.href} className={cn(link(CTA.signIn.href), "hidden sm:inline-flex")}>
            {CTA.signIn.label}
          </Link>
          <Link href={CTA.primary.href} className="fos-btn fos-btn-primary px-4 text-sm">
            {CTA.primary.label}
          </Link>
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-full text-(color:--fos-fg) transition-colors hover:bg-white/5 xl:hidden"
              >
                <Menu className="size-5" aria-hidden />
                <span className="sr-only">Open menu</span>
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="fos border-l border-(color:--fos-line) bg-(color:--fos-bg) p-0 text-(color:--fos-fg)">
              <SheetTitle className="flex items-center gap-2 px-5 pt-5 text-base font-semibold text-(color:--fos-fg)">
                <FabricGlyph className="size-5" />
                {BRAND}
              </SheetTitle>
              <nav aria-label="Mobile" className="flex flex-col px-3 pt-4 pb-6">
                {NAV.map((n) => (
                  <SheetClose asChild key={n.href}>
                    <Link
                      href={n.href}
                      className="flex min-h-12 items-center rounded-xl px-3 text-base text-(color:--fos-fg) hover:bg-white/5"
                      aria-current={isCurrent(n.href) ? "page" : undefined}
                    >
                      {n.label}
                    </Link>
                  </SheetClose>
                ))}
                <div className="mt-6 grid gap-2 border-t border-(color:--fos-line) px-2 pt-6">
                  <SheetClose asChild>
                    <Link href={CTA.primary.href} className="fos-btn fos-btn-primary">
                      {CTA.primary.label}
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link href={CTA.secondary.href} className="fos-btn fos-btn-ghost">
                      {CTA.secondary.label}
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Link href={CTA.signIn.href} className="fos-btn text-(color:--fos-muted) hover:text-(color:--fos-fg)">
                      {CTA.signIn.label}
                    </Link>
                  </SheetClose>
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
