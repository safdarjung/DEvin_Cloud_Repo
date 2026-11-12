"use client";

import { motion, useAnimate, useAnimationFrame, useReducedMotion, useSpring } from "motion/react";
import { useEffect, useRef } from "react";
import { fibonacciSphere, rotateYX } from "@/modules/ai/components/orb/orb-layout";

// A see-through wireframe ball (owner, 2026-11-12: "a 3-d skeletal ball joined by pixels", no solid
// background, nothing spilling past the edge): points on a sphere, each joined to its nearest
// neighbours, turning in real 3D. Near points are larger and brighter, far ones fade.
const POINTS = fibonacciSphere(42);
const EDGES: readonly (readonly [number, number])[] = (() => {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  POINTS.forEach((p, i) => {
    const near = POINTS.map((q, j) => ({ j, d: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 }))
      .filter((n) => n.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3);
    for (const { j } of near) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(i < j ? [i, j] : [j, i]);
      }
    }
  });
  return out;
})();
const R = 1;
const TILT = 0.42;
const SPIN = (2 * Math.PI) / 14; // one turn in 14 s
const LEAN_REACH = 200;
const WIGGLE_MS = 12_000;

/** Positions at an angle, rounded so the server HTML and the first browser frame match. */
function frame(ry: number, rx: number) {
  const f = (n: number) => Number(n.toFixed(3));
  const pts = POINTS.map((v) => {
    const [x, y, z] = rotateYX(v, ry, rx);
    const depth = (z + 1) / 2;
    return { x: f(x * R), y: f(-y * R), depth };
  });
  return pts;
}
const FIRST = frame(0.6, TILT);

/** The fidgety orb face: slow 3D spin, pointer lean, periodic wiggle. Button chrome lives in the parent. */
export function AskAiOrb({ idle, accent, glow, excite }: { idle: boolean; accent: readonly [string, string]; /** Nudge colour while a nudge is showing: the ball spins faster and lights up in it. */ glow?: string; /** Bump to play a short attention wiggle. */ excite: number }) {
  const reduced = useReducedMotion();
  const [scope, animateWiggle] = useAnimate();
  const dots = useRef<(SVGCircleElement | null)[]>([]);
  const lines = useRef<(SVGLineElement | null)[]>([]);
  const turn = useRef({ ry: 0.6, leanX: 0, leanY: 0 });
  const speed = useSpring(1, { stiffness: 50, damping: 10 });
  useEffect(() => {
    speed.set(glow ? 6 : 1);
  }, [glow, speed]);

  // The ball leans a little toward a nearby pointer (mouse only).
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
      const k = d > LEAN_REACH || d === 0 ? 0 : 1 - d / LEAN_REACH;
      turn.current.leanX = (dx / (d || 1)) * k * 0.5;
      turn.current.leanY = (dy / (d || 1)) * k * 0.4;
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [reduced, scope]);

  // Drawn by hand each frame (no React render): 42 points and their joins.
  useAnimationFrame((_, delta) => {
    if (reduced) return;
    const t = turn.current;
    t.ry += (delta / 1000) * SPIN * speed.get();
    const pts = frame(t.ry + t.leanX, TILT + t.leanY);
    pts.forEach((p, i) => {
      const c = dots.current[i];
      if (!c) return;
      c.setAttribute("cx", String(p.x));
      c.setAttribute("cy", String(p.y));
      c.setAttribute("r", (0.035 + 0.055 * p.depth).toFixed(3));
      c.setAttribute("opacity", (0.25 + 0.75 * p.depth).toFixed(2));
    });
    EDGES.forEach(([a, b], i) => {
      const l = lines.current[i];
      if (!l) return;
      const pa = pts[a]!;
      const pb = pts[b]!;
      l.setAttribute("x1", String(pa.x));
      l.setAttribute("y1", String(pa.y));
      l.setAttribute("x2", String(pb.x));
      l.setAttribute("y2", String(pb.y));
      l.setAttribute("opacity", (0.12 + 0.55 * ((pa.depth + pb.depth) / 2)).toFixed(2));
    });
  });

  useEffect(() => {
    if (reduced || excite === 0 || !scope.current) return;
    void animateWiggle(scope.current, { rotate: [0, -24, 18, -10, 0] }, { duration: 0.8 });
  }, [excite, reduced, scope, animateWiggle]);
  useEffect(() => {
    if (reduced || !idle) return;
    const id = setInterval(() => void animateWiggle(scope.current, { rotate: [0, -12, 9, -5, 0] }, { duration: 0.7 }), WIGGLE_MS);
    return () => clearInterval(id);
  }, [reduced, idle, scope, animateWiggle]);

  const lineColour = glow ?? accent[0];
  const dotColour = glow ?? accent[1];
  return (
    // No fill and nothing outside the button's own circle: only a faint glow at the core for contrast.
    <span
      className="absolute inset-0 grid place-items-center rounded-full"
      style={{ background: `radial-gradient(circle, color-mix(in oklab, ${accent[1]} 22%, transparent), transparent 68%)` }}
    >
      <motion.span ref={scope} className="block size-[88%]">
        <motion.svg
          aria-hidden
          viewBox="-1.12 -1.12 2.24 2.24"
          className="size-full [filter:drop-shadow(0_1px_1.5px_rgb(0_0_0/0.25))]"
          animate={reduced || !glow ? { opacity: 1 } : { opacity: [1, 0.6, 1] }}
          transition={glow ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : { duration: 0.2 }}
        >
          <g stroke={lineColour} strokeWidth={0.035} strokeLinecap="round" className="transition-[stroke] duration-300">
            {EDGES.map(([a, b], i) => {
              const pa = FIRST[a]!;
              const pb = FIRST[b]!;
              return (
                <line
                  key={i}
                  ref={(el) => {
                    lines.current[i] = el;
                  }}
                  x1={pa.x}
                  y1={pa.y}
                  x2={pb.x}
                  y2={pb.y}
                  opacity={(0.12 + 0.55 * ((pa.depth + pb.depth) / 2)).toFixed(2)}
                />
              );
            })}
          </g>
          <g fill={dotColour} className="transition-[fill] duration-300">
            {FIRST.map((p, i) => (
              <circle
                key={i}
                ref={(el) => {
                  dots.current[i] = el;
                }}
                cx={p.x}
                cy={p.y}
                r={(0.035 + 0.055 * p.depth).toFixed(3)}
                opacity={(0.25 + 0.75 * p.depth).toFixed(2)}
              />
            ))}
          </g>
        </motion.svg>
      </motion.span>
    </span>
  );
}
