"use client";

import { animate, MotionConfig, motion, useInView, useReducedMotion, type Variants } from "motion/react";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { inr } from "@/lib/format";

/** JS mirror of the --duration-* / --ease-* tokens in globals.css (seconds). */
export const MOTION = {
  duration: { fast: 0.15, normal: 0.2, slow: 0.3 },
  ease: {
    out: [0.16, 1, 0.3, 1],
    inOut: [0.45, 0, 0.55, 1],
  },
  stagger: 0.04,
  // Critically damped (no overshoot): for layout/shared-element moves.
  spring: { type: "spring", bounce: 0, duration: 0.3 },
} as const;

/** Reduced-motion users keep opacity changes; transforms/layout are skipped. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: MOTION.duration.normal, ease: MOTION.ease.out }}
    >
      {children}
    </MotionConfig>
  );
}

const TAGS = { div: motion.div, section: motion.section, li: motion.li } as const;

export function FadeIn({
  as = "div",
  delay = 0,
  className,
  children,
}: {
  as?: keyof typeof TAGS;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const Tag = TAGS[as];
  return (
    <Tag className={className} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      {children}
    </Tag>
  );
}

const staggerParent: Variants = { hidden: {}, show: { transition: { staggerChildren: MOTION.stagger } } };
const staggerChild: Variants = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } };

export function Stagger({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} variants={staggerParent} initial="hidden" animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div className={className} variants={staggerChild}>
      {children}
    </motion.div>
  );
}

/** Active-tab pill: render inside the same `relative` parent per tab; it slides between tabs. */
export function LayoutPill({ layoutId, className }: { layoutId: string; className?: string }) {
  return <motion.span layoutId={layoutId} transition={MOTION.spring} className={className} aria-hidden />;
}

// Serializable key (not a function) so server components can pass it as a prop.
export type NumberFormat = "number" | "inr" | "percent";
const FORMATS: Record<NumberFormat, (n: number) => string> = {
  number: (n) => Math.round(n).toLocaleString("en-IN"),
  inr: (n) => inr(n),
  percent: (n) => `${+n.toFixed(1)}%`,
};

/**
 * Renders the final formatted value on the server and first paint (SEO/no-JS).
 * After hydration, counts up from 0 once when first in view, then from the
 * previous value on change. Reduced motion: never animates.
 */
export function AnimatedNumber({ value, format = "number" }: { value: number; format?: NumberFormat }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null); // value currently displayed; null = not yet animated
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true });
  const fmt = FORMATS[format];

  // Before first paint after hydration: show 0 so the count-up has no flash of the final value.
  useLayoutEffect(() => {
    if (!reduce && ref.current && shown.current === null) ref.current.textContent = fmt(0);
  }, [reduce, fmt]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = fmt(value);
      shown.current = value;
      return;
    }
    if (!inView) return;
    const controls = animate(shown.current ?? 0, value, {
      duration: MOTION.duration.slow * 2,
      ease: MOTION.ease.out,
      onUpdate: (v) => {
        el.textContent = fmt(v);
        shown.current = v;
      },
    });
    return () => controls.stop();
  }, [value, inView, reduce, fmt]);

  return (
    <span ref={ref} className="tabular-nums">
      {fmt(value)}
    </span>
  );
}
