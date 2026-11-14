"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { PROBLEM } from "./content";
import { FabricGlyph } from "./fabric-glyph";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Final (connected) positions, in % of the diagram box. Chosen so the longest
// label still fits inside a 320px-wide box.
const POS: readonly [number, number][] = [
  [24, 14],
  [76, 18],
  [80, 52],
  [62, 88],
  [22, 82],
  [20, 48],
];
// Where each fragment starts before the system pulls it in (px offset, degrees).
const SCATTER: readonly [number, number, number][] = [
  [-40, -46, -9],
  [52, -30, 7],
  [64, 24, -6],
  [30, 60, 5],
  [-56, 40, 8],
  [-60, -8, -5],
];

/**
 * Six disconnected tools drift in from scattered positions and are stitched to
 * one core as the section scrolls. Without JS, or with reduced motion, the
 * connected end state is what renders.
 */
export function ProblemDiagram() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const frags = gsap.utils.toArray<HTMLElement>("[data-frag]");
        const spokes = gsap.utils.toArray<SVGLineElement>("[data-spoke]");
        const ring = gsap.utils.toArray<SVGPathElement>("[data-ring]");
        const tl = gsap.timeline({
          scrollTrigger: { trigger: root.current, start: "top 80%", end: "center 45%", scrub: 0.8 },
        });
        tl.from(frags, {
          x: (i) => SCATTER[i][0],
          y: (i) => SCATTER[i][1],
          rotate: (i) => SCATTER[i][2],
          opacity: 0.45,
          ease: "power2.out",
          duration: 1,
        })
          .from("[data-core]", { scale: 0.6, opacity: 0, ease: "back.out(1.6)", duration: 0.5 }, 0.3)
          .from(spokes, { strokeDashoffset: 1, stagger: 0.06, duration: 0.6, ease: "none" }, 0.5)
          .from(ring, { strokeDashoffset: 1, duration: 0.7, ease: "none" }, 0.9)
          .to(frags, { borderColor: "rgb(139 147 255 / 0.45)", color: "#eef0f6", stagger: 0.04, duration: 0.3 }, 1);
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  const ringPath = POS.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ") + " Z";

  return (
    <div ref={root} className="relative mx-auto aspect-[1/1] w-full max-w-[560px] sm:aspect-[6/5]" role="img" aria-label={`${PROBLEM.fragments.join(", ")}, connected to one FabricOS core.`}>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="fos-spoke" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#67d7ea" />
            <stop offset="1" stopColor="#8b93ff" />
          </linearGradient>
        </defs>
        <path data-ring d={ringPath} pathLength={1} strokeDasharray="1" strokeDashoffset="0" fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="0.22" />
        {POS.map(([x, y], i) => (
          <line key={i} data-spoke x1="50" y1="50" x2={x} y2={y} pathLength={1} strokeDasharray="1" strokeDashoffset="0" stroke="url(#fos-spoke)" strokeWidth="0.3" />
        ))}
      </svg>

      <div data-core className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
        <span className="grid size-16 place-items-center rounded-2xl border border-(color:--fos-line-strong) bg-(color:--fos-elev) shadow-[0_20px_60px_-20px_rgb(103_215_234_/_0.45)]">
          <FabricGlyph className="size-8" />
        </span>
        <span className="text-xs font-medium tracking-wide text-(color:--fos-fg)">FabricOS</span>
      </div>

      {PROBLEM.fragments.map((f, i) => (
        <span
          key={f}
          data-frag
          className="absolute rounded-full border border-(color:--fos-line-strong) bg-(color:--fos-surface) px-3 py-1.5 text-[13px] whitespace-nowrap text-(color:--fos-muted)"
          style={{ left: `${POS[i][0]}%`, top: `${POS[i][1]}%`, translate: "-50% -50%" }}
        >
          {f}
        </span>
      ))}
    </div>
  );
}
