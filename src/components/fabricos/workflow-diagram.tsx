"use client";

import { useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";
import { cn } from "cn";
import { WORKFLOW } from "./content";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Request to outcome as one wire. The wire draws in as the diagram scrolls
 * into view and each stage lights up when the wire reaches it. Horizontal from
 * lg up, vertical below. Static and complete without JS or with reduced motion.
 */
export function WorkflowDiagram() {
  const root = useRef<HTMLOListElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(
        { wide: "(min-width: 1024px)", motion: "(prefers-reduced-motion: no-preference)" },
        (ctx) => {
          const { wide, motion } = ctx.conditions as { wide: boolean; motion: boolean };
          if (!motion) return;
          const nodes = gsap.utils.toArray<HTMLElement>("[data-node]");
          const copy = gsap.utils.toArray<HTMLElement>("[data-stage-copy]");
          const tl = gsap.timeline({
            scrollTrigger: { trigger: root.current, start: "top 78%", end: "bottom 60%", scrub: 0.7 },
          });
          tl.fromTo(
            "[data-wire]",
            { clipPath: wide ? "inset(0% 100% 0% 0%)" : "inset(0% 0% 100% 0%)" },
            { clipPath: "inset(0% 0% 0% 0%)", ease: "none", duration: 1 },
          );
          nodes.forEach((n, i) => {
            const at = i / (nodes.length - 1);
            tl.from(n, { scale: 0.4, opacity: 0.2, duration: 0.12, ease: "back.out(2)" }, Math.max(0, at - 0.04));
            tl.from(copy[i], { opacity: 0.25, y: 10, duration: 0.15, ease: "power2.out" }, Math.max(0, at - 0.04));
          });
        },
      );
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <ol ref={root} className="relative grid gap-10 pl-10 lg:grid-cols-6 lg:gap-6 lg:pt-14 lg:pl-0">
      {/* wire */}
      <span aria-hidden className="absolute top-2 bottom-2 left-[11px] w-px lg:top-[19px] lg:right-[8%] lg:bottom-auto lg:left-[8%] lg:h-px lg:w-auto">
        <span data-wire className="absolute inset-0 bg-[linear-gradient(180deg,#67d7ea,#8b93ff)] lg:bg-[linear-gradient(90deg,#67d7ea,#8b93ff_70%,#f2c063_82%,#5fd39a)]" />
      </span>

      {WORKFLOW.map((s) => {
        const human = s.id === "approval";
        return (
          <li key={s.id} className="relative lg:text-center">
            <span
              data-node
              aria-hidden
              className={cn(
                "absolute top-1 -left-10 grid size-6 place-items-center rounded-full border bg-(color:--fos-bg) lg:static lg:mx-auto lg:-mt-14 lg:mb-8 lg:size-10",
                human ? "border-(color:--fos-warn)" : "border-(color:--fos-line-strong)",
              )}
            >
              <span className={cn("size-2 rounded-full lg:size-2.5", human ? "bg-(color:--fos-warn)" : s.id === "outcome" ? "bg-(color:--fos-ok)" : "bg-(color:--fos-cyan)")} />
            </span>
            <div data-stage-copy>
              <h3 className="text-base font-medium tracking-[-0.01em] text-(color:--fos-fg)">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-(color:--fos-muted)">{s.body}</p>
              {human ? <p className="mt-3 inline-block rounded-full border border-(color:--fos-warn)/40 px-2.5 py-0.5 text-xs text-(color:--fos-warn)">A person decides</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
