"use client";

// GSAP entrance choreography for dashboard home pages. Wrap a region in
// <GsapStage>; mark children with `data-gsap="rise"` (cards: lift + fade,
// staggered, below-the-fold ones on scroll) or `data-gsap="hero"` (header:
// slide in first). Server-rendered content stays in the HTML; CSS in
// globals.css keeps marked nodes hidden only until GSAP takes over (or a 2s
// failsafe reveals them if JS never runs). Reduced motion: nothing animates.
import { useRef, type ReactNode } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

export function GsapStage({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const stage = ref.current;
      if (!stage) return;
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const hero = gsap.utils.toArray<HTMLElement>('[data-gsap="hero"]', stage);
        const items = gsap.utils.toArray<HTMLElement>('[data-gsap="rise"]', stage);
        gsap.set(hero, { autoAlpha: 0, x: -16 });
        gsap.set(items, { autoAlpha: 0, y: 28, scale: 0.985 });
        stage.setAttribute("data-gsap-ready", "");

        gsap.to(hero, { autoAlpha: 1, x: 0, duration: 0.6, ease: "power3.out", stagger: 0.08 });
        ScrollTrigger.batch(items, {
          start: "top 92%",
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              autoAlpha: 1,
              y: 0,
              scale: 1,
              duration: 0.7,
              ease: "power3.out",
              stagger: 0.07,
              delay: 0.1,
              clearProps: "transform",
            }),
        });
      });
      mm.add("(prefers-reduced-motion: reduce)", () => {
        stage.setAttribute("data-gsap-ready", "");
      });
      return () => mm.revert();
    },
    { scope: ref },
  );

  return (
    <div ref={ref} data-gsap-stage="" className={className}>
      {children}
    </div>
  );
}
