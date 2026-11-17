"use client";

// In-app guided tour: opens each of the signed-in member's sidebar tabs in turn, rings the tab in the
// sidebar and says what the page is for. Opens by itself on a member's first visit (per browser), and
// again from the account menu ("Take the tour", TOUR_START_EVENT; "Try one feature" opens the picker).
// Steps come from the same nav list the sidebar renders, so the tour never shows a tab the member
// can't open. Each step can hand a question about that page to the Orb, and in the demo school make
// practice records for it (src/modules/core/practice) so a person can try one feature with a situation
// they pick.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { TOUR_START_EVENT, type TourStep } from "@/lib/tour";
import { runPracticeScenario } from "@/modules/core/practice/actions";
import type { PracticeScenarioKey } from "@/modules/core/practice/scenarios";

type Box = { top: number; left: number; width: number; height: number };

interface AppTourProps {
  steps: TourStep[];
  intro: string;
  roleLabel: string;
  storageKey: string;
  /** The member's Orb tab, or null when they have none. */
  orbHref: string | null;
  institutionSlug: string;
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

function groupSteps(steps: TourStep[]): [string, { step: TourStep; n: number }[]][] {
  const groups = new Map<string, { step: TourStep; n: number }[]>();
  steps.forEach((step, i) => groups.set(step.group, [...(groups.get(step.group) ?? []), { step, n: i + 1 }]));
  return [...groups];
}

// A two-line choice (title + detail) that grows with its text, unlike the fixed-height Button.
const choice =
  "w-full rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50";

function TryIt({ step, orbHref, institutionSlug, onOrb }: { step: TourStep; orbHref: string | null; institutionSlug: string; onOrb: (href: string) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string; href?: string } | null>(null);
  const practice = step.practice ?? [];
  if (!practice.length && !(orbHref && step.ask)) return null;

  const make = (key: string) =>
    start(async () => {
      setResult(null);
      try {
        const res = await runPracticeScenario(institutionSlug, { scenario: key as PracticeScenarioKey });
        setResult(res.ok ? { ok: true, text: res.data.href ? res.data.message : `${res.data.message} It is on this page now.`, href: res.data.href } : { ok: false, text: res.error.message });
        if (res.ok) router.refresh();
      } catch {
        setResult({ ok: false, text: "Could not reach the server. Check your connection and try again." });
      }
    });

  return (
    <div className="mt-3 space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Try it</p>
      {orbHref && step.ask && (
        <button type="button" className={choice} onClick={() => onOrb(`${orbHref}?q=${encodeURIComponent(step.ask!)}`)}>
          <span className="font-medium">Ask the Orb</span>
          <span className="block text-xs text-muted-foreground">“{step.ask}”</span>
        </button>
      )}
      {practice.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground">Make practice data for this page (demo school only, cleared when the demo resets):</p>
          <div className="flex flex-col gap-1.5">
            {practice.map((p) => (
              <button key={p.key} type="button" disabled={pending} className={choice} onClick={() => make(p.key)}>
                <span className="font-medium">{p.label}</span>
                <span className="block text-xs text-muted-foreground">{p.detail}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {pending && <p className="text-xs text-muted-foreground" role="status">Making it…</p>}
      {result && (
        <p className={result.ok ? "text-xs text-foreground" : "text-xs text-destructive"} role="status">
          {result.text}
          {result.href && (
            <>
              {" "}
              <Link href={result.href} className="font-medium underline underline-offset-2">
                Open it
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

export function AppTour({ steps, intro, roleLabel, storageKey, orbHref, institutionSlug }: AppTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  // null: closed · 0: welcome · 1..n: a tab · n+1: closing card.
  const [index, setIndex] = useState<number | null>(null);
  // "pick": choosing one feature · "one": showing the feature picked · "all": the full tour.
  const [mode, setMode] = useState<"all" | "pick" | "one">("all");
  const [box, setBox] = useState<Box | null>(null);
  // Hidden to a small pill so the page under the card (a form, a save button) can be used.
  const [hidden, setHidden] = useState(false);
  const total = steps.length;
  const step = mode !== "pick" && index !== null && index >= 1 && index <= total ? steps[index - 1] : null;

  // First visit opens the welcome card; the school setup page is left alone so the owner finishes it first.
  useEffect(() => {
    let seen = true;
    try {
      seen = window.localStorage.getItem(storageKey) !== null;
    } catch {
      // Storage blocked (private mode): never auto-open, the menu still starts it.
    }
    // Opens by itself only on a home page, never over a form someone came to fill in.
    const onHome = /\/(dashboard|today|portal)$/.test(window.location.pathname);
    const timer = !seen && onHome ? window.setTimeout(() => setIndex(0), 900) : undefined;
    const start = (e: Event) => {
      setMode((e as CustomEvent).detail === "pick" ? "pick" : "all");
      setHidden(false);
      setIndex(0);
    };
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
    setMode("all");
    setHidden(false);
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

  const pickOne = (n: number) => {
    setMode("one");
    go(n);
  };

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
      // Arrow keys only step through the full tour; typing in a page field must not move it.
      const typing = e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") close();
      else if (typing || mode !== "all") return;
      else if (e.key === "ArrowRight" && index <= total) go(index + 1);
      else if (e.key === "ArrowLeft" && index > 1) go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, mode, total, go, close]);

  if (index === null) return null;
  if (hidden) {
    return (
      <button
        type="button"
        onClick={() => setHidden(false)}
        className="fixed right-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-(--z-toast) rounded-full border bg-popover px-4 py-2 text-sm font-medium text-popover-foreground shadow-lg hover:bg-accent lg:bottom-24"
      >
        {step ? `Tour: ${step.title}` : "Tour"} · Show
      </button>
    );
  }
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
        key={`${mode}-${index}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="app-tour-title"
        aria-describedby="app-tour-text"
        className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-(--z-toast) mx-auto flex max-h-[calc(100dvh-8rem)] max-w-md flex-col overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-xl lg:inset-x-auto lg:right-6 lg:bottom-24 lg:w-[26rem]"
      >
        {index === 0 && mode === "all" && (
          <>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Guided tour</p>
            <h2 id="app-tour-title" className="mt-1 text-lg font-semibold">
              Welcome, {roleLabel}
            </h2>
            <p id="app-tour-text" className="mt-2 text-sm text-muted-foreground">
              {intro} Would you like a guided tour? It opens each of your {total} tabs in turn and says what it is for, about {minutes} minutes. Or pick
              one feature to try on its own.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="button" autoFocus onClick={() => go(1)}>
                Yes, show me the tour
              </Button>
              <Button type="button" variant="secondary" onClick={() => setMode("pick")}>
                Try one feature
              </Button>
              <Button type="button" variant="outline" onClick={close}>
                No, continue
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">You can come back to this from your account menu, top right.</p>
          </>
        )}

        {mode === "pick" && (
          <>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Try one feature</p>
            <h2 id="app-tour-title" className="mt-1 text-lg font-semibold">
              What would you like to try?
            </h2>
            <p id="app-tour-text" className="mt-1 text-sm text-muted-foreground">
              Pick a tab. You will see what it is for, a question to ask the Orb about it and, where it helps, practice data to test it with.
            </p>
            <div className="mt-3 space-y-3">
              {groupSteps(steps).map(([group, items]) => (
                <section key={group} aria-label={group}>
                  <p className="text-xs font-medium text-muted-foreground">{group}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {items.map(({ step: s, n }) => (
                      <Button key={s.href} type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => pickOne(n)}>
                        {s.title}
                        {s.practice?.length ? <span className="ml-1 text-primary" aria-label="has practice data">•</span> : null}
                      </Button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            {steps.some((s) => s.practice?.length) && <p className="mt-3 text-xs text-muted-foreground"><span className="text-primary">•</span> can make practice data in one click.</p>}
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="outline" onClick={close}>
                Close
              </Button>
            </div>
          </>
        )}

        {step && (
          <>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {mode === "one" ? step.group : `${index} of ${total} · ${step.group}`}
            </p>
            <h2 id="app-tour-title" className="mt-1 text-lg font-semibold">
              {step.title}
            </h2>
            <p id="app-tour-text" className="mt-2 text-sm text-muted-foreground">
              {step.text}
            </p>
            {!box && <p className="mt-2 text-xs text-muted-foreground lg:hidden">This tab is in the menu (☰ at the top left).</p>}
            <TryIt key={step.href} step={step} orbHref={orbHref} institutionSlug={institutionSlug} onOrb={(href) => router.push(href)} />
            {mode === "all" && (
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${(index / total) * 100}%` }} />
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {mode === "all" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => go(index - 1)} disabled={index === 1}>
                    Back
                  </Button>
                  <Button type="button" autoFocus onClick={() => go(index + 1)}>
                    {index === total ? "Finish" : "Next"}
                  </Button>
                </>
              ) : (
                <Button type="button" autoFocus onClick={() => setMode("pick")}>
                  Pick another feature
                </Button>
              )}
              <Button type="button" variant="ghost" className="ml-auto" onClick={() => setHidden(true)}>
                Hide
              </Button>
              <Button type="button" variant="ghost" onClick={close}>
                {mode === "all" ? "End tour" : "Close"}
              </Button>
            </div>
          </>
        )}

        {mode === "all" && index === total + 1 && (
          <>
            <h2 id="app-tour-title" className="text-lg font-semibold">
              That is the whole tour
            </h2>
            <p id="app-tour-text" className="mt-2 text-sm text-muted-foreground">
              To see it again, or to try one feature with practice data, open your account menu (your name, top right).
            </p>
            <div className="mt-4 flex gap-2">
              <Button type="button" autoFocus onClick={close}>
                Done
              </Button>
              <Button type="button" variant="outline" onClick={() => setMode("pick")}>
                Try one feature
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
