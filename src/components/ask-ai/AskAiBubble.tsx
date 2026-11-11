"use client";

import { ArrowUpRight, X } from "lucide-react";
import { animate, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Nudge } from "@/modules/ai/nudges";
import { KIND_META } from "./nudge-kind";

const BTN = "rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

/** Speech bubble that grows out of the orb. `jiggle` changes whenever the orb is pressed. */
export function AskAiBubble({ nudge, count, index, onGo, onDismiss, onAsk, onNavigate, auto, reduced, side, vertical, jiggle }: {
  nudge: Nudge;
  count: number;
  index: number;
  onGo: (i: number) => void;
  onDismiss: () => void;
  onAsk: () => void;
  onNavigate: () => void;
  /** Unprompted: announce politely. Hover/focus: stay quiet for screen readers. */
  auto: boolean;
  reduced: boolean;
  side: "left" | "right";
  vertical: "top" | "bottom";
  jiggle: number;
}) {
  const el = useRef<HTMLDivElement>(null);
  const { label, Icon, text } = KIND_META[nudge.kind];

  useEffect(() => {
    if (jiggle > 0 && !reduced && el.current) void animate(el.current, { rotate: [0, -4, 4, -2, 0] }, { duration: 0.4 });
  }, [jiggle, reduced]);

  const origin = `${vertical} ${side === "left" ? "right" : "left"}`;
  return (
    <motion.div
      ref={el}
      role="status"
      aria-live={auto ? "polite" : "off"}
      onPointerDown={(e) => e.stopPropagation()} // keep the orb's drag from starting on the bubble
      style={{ transformOrigin: origin }}
      initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.3, x: side === "left" ? 14 : -14 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, x: 0, rotate: [-5, 3, -1.5, 0] }}
      exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, transition: { duration: 0.14 } }}
      transition={reduced ? { duration: 0.12 } : { type: "spring", stiffness: 420, damping: 13, rotate: { duration: 0.55 } }}
      className={`absolute ${vertical === "top" ? "top-0" : "bottom-0"} ${side === "left" ? "right-full mr-3" : "left-full ml-3"} w-[min(17rem,calc(100vw-6.5rem))] rounded-2xl border border-border bg-card p-3 text-left text-card-foreground shadow-xl`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex items-center gap-1 text-[11px] font-semibold tracking-wide uppercase ${text}`}>
          <Icon className="size-3.5" aria-hidden />
          {label}
        </span>
        <button type="button" aria-label="Dismiss this nudge" onClick={onDismiss} className={`grid size-6 place-items-center text-muted-foreground hover:bg-accent ${BTN}`}>
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <Link href={nudge.href} onClick={onNavigate} className="mt-1 block text-sm leading-snug font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        {nudge.text}
      </Link>
      <div className="mt-2 flex items-center justify-between gap-2">
        <button type="button" onClick={onAsk} className={`flex items-center gap-1 border border-border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent ${BTN}`}>
          Ask about this
          <ArrowUpRight className="size-3" aria-hidden />
        </button>
        {count > 1 && (
          <div className="flex items-center gap-0.5" role="group" aria-label="Nudges">
            {Array.from({ length: count }, (_, i) => (
              <button key={i} type="button" aria-label={`Nudge ${i + 1} of ${count}`} aria-current={i === index} onClick={() => onGo(i)} className={`grid size-4 place-items-center ${BTN}`}>
                <span className={`block rounded-full bg-foreground transition-all ${i === index ? "size-2" : "size-1.5 opacity-30"}`} />
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
