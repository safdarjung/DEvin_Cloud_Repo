"use client";

import { Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { orbUrl } from "@/components/ask-ai/suggestions";
import { ORB_ASK_KEY } from "@/modules/ai/components/orb/orb-modes";
import { isEditableTarget, isInternalNav, matchShortcut, SHORTCUTS, selectionQuestion } from "./shell-logic";

/** Mounted once in the tenant layout: navigation bar, select-to-ask pill, Ctrl+J and "?" shortcuts. */
export function ShellExtras({ institutionSlug }: { institutionSlug: string }) {
  const pathname = usePathname();
  const onOrb = pathname === `/${institutionSlug}/orb` || pathname.startsWith(`/${institutionSlug}/orb/`);
  return (
    <>
      <NavProgress pathname={pathname} />
      <Shortcuts institutionSlug={institutionSlug} pathname={pathname} onOrb={onOrb} />
      {!onOrb && <SelectAsk institutionSlug={institutionSlug} pathname={pathname} />}
    </>
  );
}

type Phase = "idle" | "run" | "done";

// App Router has no global route-change event, and useLinkStatus only reaches inside one <Link>.
// So: a delegated click on in-app links starts the bar; the new pathname finishing render ends it.
function NavProgress({ pathname }: { pathname: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const last = useRef(pathname);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      if (isInternalNav(a.href, window.location.href)) setPhase("run");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (last.current === pathname) return;
    last.current = pathname;
    setPhase((p) => (p === "run" ? "done" : p));
  }, [pathname]);

  useEffect(() => {
    if (phase === "idle") return;
    // "done" fades out; "run" gives up after 10s (a cancelled or failed navigation).
    const t = setTimeout(() => setPhase("idle"), phase === "done" ? 400 : 10000);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === "idle") return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-(--z-toast) h-0.5">
      <div
        className="h-full bg-primary shadow-[0_0_8px_var(--color-primary)] motion-reduce:transition-none"
        style={{
          width: phase === "done" ? "100%" : "80%",
          opacity: phase === "done" ? 0 : 1,
          transition: phase === "done" ? "width 150ms ease-out, opacity 250ms ease-out 150ms" : "width 8s cubic-bezier(0.1, 0.6, 0.2, 1)",
        }}
      />
    </div>
  );
}

function Shortcuts({ institutionSlug, pathname, onOrb }: { institutionSlug: string; pathname: string; onOrb: boolean }) {
  const router = useRouter();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = matchShortcut(e, isEditableTarget(e.target as Element | null));
      if (!action) return;
      // The launcher panel's own Ctrl+J (focus its jump filter) and any open dialog win.
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      if (action === "help") setHelp(true);
      else if (!onOrb) router.push(orbUrl(institutionSlug, pathname));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, institutionSlug, pathname, onOrb]);

  return (
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts that work in this app.</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="contents">
              <dt>
                <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">{s.keys}</kbd>
              </dt>
              <dd className="text-muted-foreground">{s.label}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

type Pill = { x: number; y: number; text: string };

function SelectAsk({ institutionSlug, pathname }: { institutionSlug: string; pathname: string }) {
  const router = useRouter();
  const [pill, setPill] = useState<Pill | null>(null);

  useEffect(() => {
    function check() {
      const sel = window.getSelection();
      const main = document.getElementById("main-content");
      const node = sel?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement ?? null;
      const text = sel?.toString() ?? "";
      const blocked = !sel || sel.isCollapsed || !main || !node || !sel.focusNode || !main.contains(node) || !main.contains(sel.focusNode) || isEditableTarget(el) || el?.closest("[contenteditable]");
      if (blocked || !selectionQuestion(text)) return setPill(null);
      const r = sel.getRangeAt(sel.rangeCount - 1).getBoundingClientRect();
      setPill({ x: Math.min(Math.max(r.right, 70), window.innerWidth - 70), y: Math.min(r.bottom + 8, window.innerHeight - 48), text });
    }
    const hide = () => setPill(null);
    const onKey = (e: KeyboardEvent) => (e.key === "Escape" ? hide() : check());
    document.addEventListener("mouseup", check);
    document.addEventListener("keyup", onKey);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseup", check);
      document.removeEventListener("keyup", onKey);
      document.removeEventListener("scroll", hide, true);
    };
  }, [institutionSlug, pathname]);

  if (!pill) return null;
  return (
    <button
      type="button"
      aria-label="Ask AI about the selected text"
      // mousedown would collapse the selection before click lands
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        const question = selectionQuestion(pill.text);
        setPill(null);
        if (!question) return;
        try {
          window.sessionStorage.setItem(ORB_ASK_KEY, question);
        } catch {
          return; // storage blocked: nothing to hand over, so stay on the page
        }
        router.push(orbUrl(institutionSlug, pathname));
      }}
      style={{ left: pill.x, top: pill.y }}
      className="fixed z-(--z-toast) flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-safe:animate-in motion-safe:fade-in"
    >
      <Sparkles className="size-3.5" aria-hidden />
      Ask AI
    </button>
  );
}
