"use client";

// In-app guided tour: opens each of the signed-in member's sidebar tabs in turn, rings the tab in the
// sidebar and says what the page is for. Opens by itself on a member's first visit (per browser), and
// again from the account menu ("Take the tour", TOUR_START_EVENT). Steps come from the same nav list
// the sidebar renders, so the tour never shows a tab the member can't open.
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { TOUR_START_EVENT, type TourStep } from "@/lib/tour";

type Box = { top: number; left: number; width: number; height: number };

interface AppTourProps {
  steps: TourStep[];
  intro: string;
  roleLabel: string;
  storageKey: string;
}

function findTab(href: string): HTMLAnchorElement | null {
  // The sidebar on wide screens; the bottom bar on phones holds a few tabs too.
  const links = document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary"] a, nav[aria-label="Quick navigation"] a');
  for (const a of links) {
    const h = a.getAttribute("href") ?? "";
    // offsetParent is null while the link is hidden (the desktop sidebar on a phone).
    if ((h === href || h.startsWith(`${href}?`)) && a.offsetParent !== null) return a;
  }
  return null;
}

export function AppTour({ steps, intro, roleLabel, storageKey }: AppTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  // null: closed · 0: welcome · 1..n: a tab · n+1: closing card.
  const [index, setIndex] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const total = steps.length;
  const step = index !== null && index >= 1 && index <= total ? steps[index - 1] : null;

  // First visit opens the welcome card; the school setup page is left alone so the owner finishes it first.
  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(storageKey) !== null;
    } catch {
      // Storage blocked (private mode): never auto-open, the menu still starts it.
    }
    const onSetup = window.location.pathname.endsWith("/setup");
    const timer = !seen && !onSetup ? window.setTimeout(() => setIndex(0), 900) : undefined;
    const start = () => setIndex(0);
    window.addEventListener(TOUR_START_EVENT, start);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(TOUR_START_EVENT, start);
    };
  }, [storageKey]);

  const close = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, "done");
    } catch {
      // Nothing to remember without storage.
    }
    setIndex(null);
    setBox(null);
  }, [storageKey]);

  const go = useCallback(
    (next: number) => {
      setIndex(next);
      const target = next >= 1 && next <= total ? steps[next - 1] : null;
      if (target && pathname !== target.href) router.push(target.href);
    },
    [pathname, router, steps, total],
  );

  // Ring the current tab in the sidebar; re-measured while the page under it loads and scrolls.
  useEffect(() => {
    if (!step) return;
    let scrolled = false;
    const measure = () => {
      const el = findTab(step.href);
      if (el && !scrolled) {
        el.scrollIntoView({ block: "nearest" });
        scrolled = true;
      }
      const r = el?.getBoundingClientRect();
      const nextBox = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
      setBox((prev) =>
        prev && nextBox && prev.top === nextBox.top && prev.left === nextBox.left && prev.width === nextBox.width ? prev : nextBox,
      );
    };
    const frame = window.requestAnimationFrame(measure);
    const id = window.setInterval(measure, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(id);
    };
  }, [step]);

  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" && index <= total) go(index + 1);
      else if (e.key === "ArrowLeft" && index > 1) go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, total, go, close]);

  if (index === null) return null;
  const minutes = Math.max(1, Math.round(total / 4));

  return (
    <>
      {step && box && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-(--z-toast) rounded-md ring-2 ring-sidebar-primary ring-offset-2 ring-offset-sidebar transition-all duration-200 motion-reduce:transition-none"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        />
      )}
      <div
        key={index}
        role="dialog"
        aria-modal="false"
        aria-labelledby="app-tour-title"
        aria-describedby="app-tour-text"
        className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-(--z-toast) mx-auto max-w-md rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl lg:inset-x-auto lg:right-6 lg:bottom-24 lg:w-[26rem]"
      >
        {index === 0 && (
          <>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Guided tour</p>
            <h2 id="app-tour-title" className="mt-1 text-lg font-semibold">
              Welcome, {roleLabel}
            </h2>
            <p id="app-tour-text" className="mt-2 text-sm text-muted-foreground">
              {intro} Would you like a guided tour? It opens each of your {total} tabs in turn and says what it is for, about {minutes} minutes.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" autoFocus onClick={() => go(1)}>
                Yes, show me the tour
              </Button>
              <Button type="button" variant="outline" onClick={close}>
                No, continue to the app
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">You can take the tour later from your account menu, top right.</p>
          </>
        )}

        {step && (
          <>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {index} of {total} · {step.group}
            </p>
            <h2 id="app-tour-title" className="mt-1 text-lg font-semibold">
              {step.title}
            </h2>
            <p id="app-tour-text" className="mt-2 text-sm text-muted-foreground">
              {step.text}
            </p>
            {!box && <p className="mt-2 text-xs text-muted-foreground lg:hidden">This tab is in the menu (☰ at the top left).</p>}
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${(index / total) * 100}%` }} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" onClick={() => go(index - 1)} disabled={index === 1}>
                Back
              </Button>
              <Button type="button" autoFocus onClick={() => go(index + 1)}>
                {index === total ? "Finish" : "Next"}
              </Button>
              <Button type="button" variant="ghost" className="ml-auto" onClick={close}>
                End tour
              </Button>
            </div>
          </>
        )}

        {index === total + 1 && (
          <>
            <h2 id="app-tour-title" className="text-lg font-semibold">
              That is the whole tour
            </h2>
            <p id="app-tour-text" className="mt-2 text-sm text-muted-foreground">
              To see it again, open your account menu (your name, top right) and choose Take the tour.
            </p>
            <div className="mt-4">
              <Button type="button" autoFocus onClick={close}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
