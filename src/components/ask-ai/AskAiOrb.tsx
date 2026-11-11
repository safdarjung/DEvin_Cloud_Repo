"use client";

import { motion, useAnimate, useAnimationFrame, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
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
export function AskAiOrb({ idle, accent, glow, excite }: { idle: boolean; accent: readonly [string, string]; /** Nudge colour while a nudge is showing: dots swirl faster and pulse in it. */ glow?: string; /** Bump to play a short attention wiggle. */ excite: number }) {
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

  // Spin is driven by hand so its speed can spring up while a nudge shows.
  const angle = useMotionValue(0);
  const speed = useSpring(1, { stiffness: 50, damping: 10 });
  useEffect(() => {
    speed.set(glow ? 7 : 1);
  }, [glow, speed]);
  useAnimationFrame((_, delta) => {
    if (!reduced) angle.set((angle.get() + (delta / 1000) * (360 / 48) * speed.get()) % 360);
  });
  useEffect(() => {
    if (reduced || excite === 0 || !scope.current) return;
    void animateWiggle(scope.current, { rotate: [0, -28, 22, -14, 0] }, { duration: 0.8 });
  }, [excite, reduced, scope, animateWiggle]);

  useEffect(() => {
    if (reduced || !idle) return;
    const id = setInterval(() => void animateWiggle(scope.current, { rotate: [0, -14, 11, -6, 0] }, { duration: 0.7 }), WIGGLE_MS);
    return () => clearInterval(id);
  }, [reduced, idle, scope, animateWiggle]);

  return (
    // The same glass ball as the App Orb, in CSS: bright toward the light, a darker limb, a rim of the bright stop.
    <span
      className="absolute inset-0 grid place-items-center overflow-hidden rounded-full"
      style={{
        background: `radial-gradient(circle at 34% 28%, ${accent[1]}, ${accent[0]} 72%)`,
        boxShadow: `inset 0 0 10px 0 ${accent[1]}, inset -5px -7px 12px -4px rgb(0 0 0 / 0.45)`,
      }}
    >
      <motion.span ref={scope} className="block size-[78%]" animate={reduced ? undefined : { scale: [1, 1.05, 1] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
        <motion.span className="block size-full" style={{ rotate: angle }}>
          <motion.svg
            aria-hidden
            viewBox="-1.2 -1.2 2.4 2.4"
            className="size-full overflow-visible fill-white transition-[fill] duration-300"
            style={glow ? { fill: glow } : undefined}
            animate={reduced || !glow ? { opacity: 1 } : { opacity: [1, 0.55, 1] }}
            transition={glow ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
          >
            <Layer front={false} x={bx} y={by} />
            <Layer front x={sx} y={sy} />
          </motion.svg>
        </motion.span>
      </motion.span>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_24%,rgb(255_255_255/0.7),transparent_30%)]" />
    </span>
  );
}
