"use client";

import { animate, MotionConfig, motion, useInView, useReducedMotion } from "motion/react";
import { Children, cloneElement, isValidElement, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { inr } from "@/lib/format";

// CSS entrance (tw-animate-css, globals.css): runs on paint, so SSR HTML is
// visible without JS. `motion/react` is reserved for LayoutPill + AnimatedNumber.
const ENTER = "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 duration-200";

/** JS mirror of the --duration-* / --ease-* tokens in globals.css (seconds). */
export const MOTION = {
  duration: { fast: 0.15, normal: 0.2, slow: 0.3 },
  ease: {
    out: [0.16, 1, 0.3, 1],
    inOut: [0.45, 0, 0.55, 1],
  },
  stagger: 0.025,
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

const TAGS = { div: "div", section: "section", li: "li" } as const;

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
    <Tag className={[ENTER, className].filter(Boolean).join(" ")} style={delay ? { animationDelay: `${delay}s` } : undefined}>
      {children}
    </Tag>
  );
}

export function Stagger({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      {Children.map(children, (child, i) =>
        isValidElement<{ style?: CSSProperties }>(child)
          ? cloneElement(child, { style: { animationDelay: `${i * MOTION.stagger}s`, ...child.props.style } })
          : child,
      )}
    </div>
  );
}

export function StaggerItem({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div className={[ENTER, className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>
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
