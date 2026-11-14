"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { INSIGHTS } from "./content";

gsap.registerPlugin(ScrollTrigger, useGSAP);

// Shape only. No axis values: this is an illustration of how a signal reads,
// not anyone's figures.
const LINE = "M0 70 C40 62 70 58 110 64 S170 74 200 60 S260 40 300 52 S350 112 380 104 S430 60 470 58 S540 66 600 50";
const BAND_Y = 92;
const FLAGS: readonly { x: number; y: number; label: string }[] = [{ x: 368, y: 108, label: "Attendance dip" }];
const BARS = [22, 30, 18, 34, 26, 40, 31, 24, 36, 20, 28, 44];

export function InsightsChart() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const tl = gsap.timeline({ scrollTrigger: { trigger: root.current, start: "top 75%", once: true } });
        tl.from("[data-line]", { strokeDashoffset: 1, duration: 1.8, ease: "power2.inOut" })
          .from("[data-area]", { opacity: 0, duration: 0.8 }, 0.6)
          .from("[data-bar]", { scaleY: 0, transformOrigin: "50% 100%", stagger: 0.04, duration: 0.6, ease: "expo.out" }, 0.2)
          .from("[data-flag]", { scale: 0, opacity: 0, transformOrigin: "50% 50%", duration: 0.5, ease: "back.out(2.4)" }, 1.4);
      });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <div ref={root} className="rounded-[20px] border border-(color:--fos-line-strong) bg-(color:--fos-surface) p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-(color:--fos-fg)">Attention this term</p>
        <p className="fos-tag">{INSIGHTS.label}</p>
      </div>

      <svg viewBox="0 0 600 200" className="mt-6 h-auto w-full" role="img" aria-label="Illustrative chart: an attendance line dips below the usual range once, and the dip is flagged for review.">
        <defs>
          <linearGradient id="fos-ins-line" x1="0" x2="1">
            <stop offset="0" stopColor="#67d7ea" />
            <stop offset="1" stopColor="#8b93ff" />
          </linearGradient>
          <linearGradient id="fos-ins-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8b93ff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#8b93ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* grid */}
        {[40, 80, 120].map((y) => (
          <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="rgb(255 255 255 / 0.06)" />
        ))}
        {/* usual range */}
        <rect x="0" y={BAND_Y} width="600" height="2" fill="#f2c063" opacity="0.5" />
        {/* workload bars */}
        {BARS.map((h, i) => (
          <rect key={i} data-bar x={14 + i * 49} y={200 - h} width="22" height={h} rx="3" fill="rgb(255 255 255 / 0.07)" />
        ))}
        <path data-area d={`${LINE} L600 200 L0 200 Z`} fill="url(#fos-ins-area)" />
        <path data-line d={LINE} pathLength={1} strokeDasharray="1" strokeDashoffset="0" fill="none" stroke="url(#fos-ins-line)" strokeWidth="2.5" strokeLinecap="round" />
        {FLAGS.map((f) => (
          <g key={f.label}>
            <circle data-flag cx={f.x} cy={f.y} r="6" fill="#05060a" stroke="#f2c063" strokeWidth="2" />
          </g>
        ))}
      </svg>
      <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-(color:--fos-muted)">
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded-full bg-[linear-gradient(90deg,#67d7ea,#8b93ff)]" />
          Attendance
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded-full bg-(color:--fos-warn)/60" />
          Usual range
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="size-2.5 rounded-full border-2 border-(color:--fos-warn)" />
          Dip flagged for review
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2 rounded-sm bg-white/15" />
          Pending approvals
        </li>
      </ul>
    </div>
  );
}
