"use client";

import { motion, useAnimate, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";
import { fibonacciSphere, rotateYX } from "@/modules/ai/components/orb/orb-layout";

// Dot sphere, split in two depth layers so the front leans further toward the pointer (parallax).
const DOTS = fibonacciSphere(64).map((v, i) => {
  const [x, y, z] = rotateYX(v, 0.5, 0.45);
  const depth = (z + 1) / 2;
  // Rounded strings: server and browser trig differ in the last digit, which breaks hydration.
  const f = (n: number) => n.toFixed(3);
  return { cx: f(x), cy: f(-y), r: f((i % 6 === 0 ? 0.11 : 0.06) * (0.6 + 0.6 * depth)), opacity: f(0.25 + 0.75 * depth), front: depth > 0.5 };
});
const LEAN_REACH = 200;
const LEAN_PX = 5;
const WIGGLE_MS = 12_000;

function Layer({ front, x, y }: { front: boolean; x: ReturnType<typeof useSpring>; y: ReturnType<typeof useSpring> }) {
  return (
    <motion.g style={{ x, y }}>
      {DOTS.filter((d) => d.front === front).map((d, i) => (
        <circle key={i} cx={d.cx} cy={d.cy} r={d.r} opacity={d.opacity} />
      ))}
    </motion.g>
  );
}

/** The fidgety orb face: breathing, slow spin, pointer lean, periodic wiggle. Button chrome lives in the parent. */
export function AskAiOrb({ idle, accent }: { idle: boolean; accent: readonly [string, string] }) {
  const reduced = useReducedMotion();
  const [scope, animateWiggle] = useAnimate();
  const lx = useMotionValue(0);
  const ly = useMotionValue(0);
  const sx = useSpring(lx, { stiffness: 220, damping: 16 });
  const sy = useSpring(ly, { stiffness: 220, damping: 16 });
  const bx = useTransform(sx, (v) => v * 0.45);
  const by = useTransform(sy, (v) => v * 0.45);

  useEffect(() => {
    if (reduced) return;
    function onMove(e: PointerEvent) {
      if (e.pointerType === "touch") return;
      const el = scope.current as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > LEAN_REACH || d === 0) {
        lx.set(0);
        ly.set(0);
        return;
      }
      const k = (1 - d / LEAN_REACH) * LEAN_PX;
      lx.set((dx / d) * k * 0.05);
      ly.set((dy / d) * k * 0.05);
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced, scope, lx, ly]);

  useEffect(() => {
    if (reduced || !idle) return;
    const id = setInterval(() => void animateWiggle(scope.current, { rotate: [0, -14, 11, -6, 0] }, { duration: 0.7 }), WIGGLE_MS);
    return () => clearInterval(id);
  }, [reduced, idle, scope, animateWiggle]);

  return (
    <span className="absolute inset-0 grid place-items-center overflow-hidden rounded-full" style={{ background: `linear-gradient(145deg, ${accent[0]}, ${accent[1]})` }}>
      <motion.span ref={scope} className="block size-[78%]" animate={reduced ? undefined : { scale: [1, 1.05, 1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <motion.span className="block size-full" animate={reduced ? undefined : { rotate: 360 }} transition={{ duration: 48, repeat: Infinity, ease: "linear" }}>
          <svg aria-hidden viewBox="-1.2 -1.2 2.4 2.4" className="size-full overflow-visible fill-white">
            <Layer front={false} x={bx} y={by} />
            <Layer front x={sx} y={sy} />
          </svg>
        </motion.span>
      </motion.span>
    </span>
  );
}
