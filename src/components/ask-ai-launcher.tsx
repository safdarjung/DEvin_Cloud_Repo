"use client";

import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Role } from "@/lib/auth/permissions";
import { ROLE_ACCENTS } from "@/modules/ai/components/orb/orb-theme";
import { AskAiOrb } from "./ask-ai/AskAiOrb";
import { AskAiBubble } from "./ask-ai/AskAiBubble";
import { AskAiPanel, type Corner, type JumpItem } from "./ask-ai/AskAiPanel";
import { KIND_META } from "./ask-ai/nudge-kind";
import { orbUrl, pageTitleFor } from "./ask-ai/suggestions";
import { useNudgeBubble } from "./ask-ai/use-nudge-bubble";
import { useNudges } from "./ask-ai/use-nudges";

const STORE_KEY = "askai:corner";
const CORNERS: readonly Corner[] = ["br", "bl", "tr", "tl"];
const TOP_MARGIN = 80; // clears the sticky header
const SNAP = { type: "spring", stiffness: 300, damping: 22 } as const;

function readCorner(): Corner {
  try {
    const c = localStorage.getItem(STORE_KEY);
    return CORNERS.find((k) => k === c) ?? "br";
  } catch {
    return "br";
  }
}

// Floating Ask AI launcher: draggable orb (snaps to a corner) opening an anchored panel.
// The base position is bottom-right (above the mobile bottom nav); x/y are offsets to the other corners.
export function AskAiLauncher({ institutionSlug, role, jumpItems }: { institutionSlug: string; role: Role; jumpItems: JumpItem[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const dragged = useRef(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const [corner, setCorner] = useState<Corner>("br");
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<"ask" | "jump">("ask");
  const [hot, setHot] = useState(false);
  const [excite, setExcite] = useState(0);
  const [jiggle, setJiggle] = useState(0);
  const [bump, setBump] = useState(0);
  const { nudges, fresh } = useNudges(institutionSlug);
  const bubble = useNudgeBubble(nudges, fresh, open);
  const shownKind = bubble.visible ? bubble.current?.kind : undefined;
  const glow = shownKind ? KIND_META[shownKind].glow : undefined;
  const prevUnseen = useRef(0);

  // Attention wiggle when an unprompted bubble appears; badge bounce when the count rises.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- counter that triggers a one-shot animation
    if (bubble.autoShown) setExcite((n) => n + 1);
  }, [bubble.autoShown]);
  useEffect(() => {
    if (bubble.unseenAlerts > prevUnseen.current) setBump((n) => n + 1);
    prevUnseen.current = bubble.unseenAlerts;
  }, [bubble.unseenAlerts]);

  const offsetsFor = useCallback((c: Corner) => {
    const el = box.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const baseLeft = r.left - x.get();
    const baseTop = r.top - y.get();
    const margin = window.innerWidth - baseLeft - r.width;
    return { x: c.endsWith("l") ? margin - baseLeft : 0, y: c.startsWith("t") ? TOP_MARGIN - baseTop : 0 };
  }, [x, y]);

  const place = useCallback((c: Corner, instant: boolean) => {
    const t = offsetsFor(c);
    if (instant || reduced) {
      x.set(t.x);
      y.set(t.y);
    } else {
      void animate(x, t.x, SNAP);
      void animate(y, t.y, SNAP);
    }
  }, [offsetsFor, reduced, x, y]);

  useEffect(() => {
    const c = readCorner();
    place(c, true);
    const frame = requestAnimationFrame(() => setCorner(c)); // after hydration, so SSR markup matches
    const onResize = () => place(readCorner(), true);
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once; later moves go through snap()
  }, []);

  function snap() {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const left = r.left + r.width / 2 < window.innerWidth / 2;
    const top = r.top + r.height / 2 < window.innerHeight / 2;
    const c: Corner = `${top ? "t" : "b"}${left ? "l" : "r"}`;
    setCorner(c);
    place(c, false);
    try {
      localStorage.setItem(STORE_KEY, c);
    } catch {
      /* storage blocked: position just isn't remembered */
    }
  }

  const close = useCallback(() => {
    setOpen(false);
    btn.current?.focus();
  }, []);

  // Ctrl/Cmd+J: Ctrl/Cmd+K is already the header command palette.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setFocus("jump");
        setOpen(true);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (box.current?.contains(t) || (t as Element).closest?.('[role="dialog"][aria-label="Ask AI"]')) return;
      close();
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, close]);

  const orb = `/${institutionSlug}/orb`;
  if (pathname === orb || pathname.startsWith(`${orb}/`)) return null;

  const side = corner.endsWith("l") ? "left-full ml-3" : "right-full mr-3";
  const accent = ROLE_ACCENTS[role];
  return (
    <>
      <motion.div
        ref={box}
        drag
        dragMomentum={false}
        dragElastic={0.1}
        onDragStart={() => {
          dragged.current = true;
        }}
        onDragEnd={() => {
          snap();
          setTimeout(() => (dragged.current = false), 0);
        }}
        style={{ x, y }}
        onPointerEnter={(e) => e.pointerType !== "touch" && bubble.enter()}
        onPointerLeave={bubble.leave}
        onFocus={bubble.enter}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) bubble.leave();
        }}
        onKeyDown={(e) => {
          if (!bubble.visible) return;
          if (e.key === "Escape") {
            e.stopPropagation();
            bubble.hide();
          } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            bubble.step(1);
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            bubble.step(-1);
          }
        }}
        className="group fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-(--z-header) touch-none lg:right-6 lg:bottom-6 print:hidden"
      >
        <span
          aria-hidden
          className={`pointer-events-none absolute top-1/2 -translate-y-1/2 rounded-full border border-border bg-card px-3 py-1 text-sm font-medium whitespace-nowrap text-foreground opacity-0 shadow-md transition-all duration-200 motion-reduce:transition-none ${side} ${open || bubble.visible ? "hidden" : "translate-x-2 group-focus-within:translate-x-0 group-focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100"}`}
        >
          Ask AI
        </span>
        <motion.button
          ref={btn}
          type="button"
          aria-label={bubble.unseenAlerts > 0 ? `Ask AI, ${bubble.unseenAlerts} new ${bubble.unseenAlerts === 1 ? "alert" : "alerts"}` : "Ask AI"}
          aria-haspopup="dialog"
          aria-expanded={open}
          onPointerEnter={() => setHot(true)}
          onPointerLeave={() => setHot(false)}
          onPointerDown={() => bubble.visible && setJiggle((n) => n + 1)}
          animate={reduced ? undefined : { x: bubble.visible ? (corner.endsWith("l") ? 5 : -5) : 0 }}
          whileTap={reduced ? undefined : bubble.visible ? { scaleX: 1.12, scaleY: 0.78 } : { scale: 0.86 }}
          whileHover={reduced ? undefined : { scale: 1.06 }}
          transition={{ type: "spring", stiffness: 500, damping: 12 }}
          onClick={() => {
            if (dragged.current) return;
            setFocus("ask");
            setOpen((o) => !o);
          }}
          className="relative block size-14 rounded-full text-white shadow-lg ring-1 ring-black/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none lg:size-16"
        >
          <AskAiOrb idle={!open && !hot} accent={accent} glow={glow} excite={excite} />
        </motion.button>
        {glow && !reduced && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute -inset-1 rounded-full border-2"
            style={{ borderColor: glow }}
            animate={{ scale: [1, 1.3], opacity: [0.8, 0] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeOut" }}
          />
        )}
        {bubble.unseenAlerts > 0 && (
          <motion.span
            key={bump}
            aria-hidden
            initial={reduced ? false : { scale: 0.3 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 500, damping: 9 }}
            className="pointer-events-none absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-destructive px-1 text-[11px] leading-5 font-bold text-white ring-2 ring-background"
          >
            {bubble.unseenAlerts > 9 ? "9+" : bubble.unseenAlerts}
          </motion.span>
        )}
        <AnimatePresence>
          {bubble.visible && bubble.current && (
            <AskAiBubble
              key="bubble"
              nudge={bubble.current}
              count={bubble.list.length}
              index={bubble.index}
              onGo={bubble.go}
              onDismiss={() => bubble.dismiss(bubble.current!.id)}
              onAsk={() => router.push(orbUrl(institutionSlug, pathname, bubble.current!.ask))}
              onNavigate={bubble.hide}
              auto={bubble.autoShown}
              reduced={reduced}
              side={corner.endsWith("l") ? "right" : "left"}
              vertical={corner.startsWith("t") ? "top" : "bottom"}
              jiggle={jiggle}
            />
          )}
        </AnimatePresence>
      </motion.div>
      <AnimatePresence>
        {open && (
          <AskAiPanel
            slug={institutionSlug}
            pathname={pathname}
            title={pageTitleFor(pathname, jumpItems)}
            items={jumpItems}
            corner={corner}
            reduced={reduced}
            focus={focus}
            nudges={bubble.list}
            onAskNudge={(q) => router.push(orbUrl(institutionSlug, pathname, q))}
            onClose={close}
          />
        )}
      </AnimatePresence>
    </>
  );
}
