"use client";

// Near the composer: "Waiting for you" lists cards still to approve, so they are not
// lost when the conversation scrolls; a task that could not open says why and offers
// the chat instead. CardFlight is the card leaving the orb for its place (transform
// and opacity only; skipped under reduced motion).
import { motion } from "motion/react";
import { Inbox, MessageSquare, TriangleAlert, X } from "lucide-react";

export interface TrayItem {
  id: string;
  title: string;
}

export interface StartFailure {
  task: string;
  label: string;
  message: string;
}

const PILL =
  "inline-flex min-h-11 max-w-[16rem] shrink-0 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium shadow-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function OrbTray({ items, failure, chatOn, reduced, trayRef, onJump, onAskInstead, onDismissFailure }: {
  items: readonly TrayItem[];
  failure: StartFailure | null;
  chatOn: boolean;
  reduced: boolean;
  trayRef: React.RefObject<HTMLDivElement | null>;
  onJump: (id: string) => void;
  onAskInstead: (f: StartFailure) => void;
  onDismissFailure: () => void;
}) {
  if (items.length === 0 && !failure) return null;
  return (
    <div ref={trayRef} className="mx-auto flex w-full max-w-4xl flex-col gap-1.5 px-1">
      {failure && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-sm">
          <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
          <p className="min-w-0 flex-1">
            Couldn&apos;t open &ldquo;{failure.label}&rdquo;: <span className="text-muted-foreground">{failure.message}</span>
          </p>
          {chatOn && (
            <button type="button" onClick={() => onAskInstead(failure)} className={PILL}>
              <MessageSquare className="size-3.5" aria-hidden />
              Ask in chat instead
            </button>
          )}
          <button
            type="button"
            onClick={onDismissFailure}
            aria-label="Dismiss"
            className="grid size-11 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      {items.length > 0 && (
        <section aria-label="Waiting for you" className="flex items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none]">
          <h2 className="flex shrink-0 items-center gap-1 pr-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Inbox className="size-3.5" aria-hidden />
            Waiting for you
            <span className="tabular-nums">({items.length})</span>
          </h2>
          {items.map((it) => (
            <motion.button
              key={it.id}
              type="button"
              onClick={() => onJump(it.id)}
              className={PILL}
              initial={reduced ? false : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <span className="size-1.5 shrink-0 rounded-full bg-foreground" aria-hidden />
              <span className="truncate">{it.title}</span>
              <span className="sr-only">: go to the card</span>
            </motion.button>
          ))}
        </section>
      )}
    </div>
  );
}

export interface Flight {
  id: string;
  /** Orb centre (viewport px). */
  from: { x: number; y: number };
  /** Where the card landed (viewport rect). */
  to: { left: number; top: number; width: number; height: number };
}

const FLIGHT_MAX_H = 140;

export function CardFlight({ flight, hue, onDone }: { flight: Flight; hue: string; onDone: (id: string) => void }) {
  const { from, to } = flight;
  const h = Math.min(to.height, FLIGHT_MAX_H);
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none fixed z-50 rounded-2xl border border-border bg-card"
      style={{ left: to.left, top: to.top, width: to.width, height: h, boxShadow: `0 0 0 2px ${hue}, 0 24px 60px -20px ${hue}` }}
      initial={{ x: from.x - (to.left + to.width / 2), y: from.y - (to.top + h / 2), scale: 0.1, opacity: 0.3 }}
      animate={{ x: 0, y: 0, scale: 1, opacity: [0.3, 1, 1, 0] }}
      transition={{ type: "spring", stiffness: 150, damping: 20, opacity: { duration: 0.9, times: [0, 0.25, 0.7, 1] } }}
      onAnimationComplete={() => onDone(flight.id)}
    >
      <div className="m-3 h-2.5 w-2/5 rounded-full" style={{ background: hue }} />
      <div className="mx-3 h-2 w-3/4 rounded-full bg-muted" />
      <div className="mx-3 mt-2 h-2 w-1/2 rounded-full bg-muted" />
    </motion.div>
  );
}
