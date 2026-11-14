"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * Scroll-driven reveals for server-rendered content inside it.
 *
 *   [data-reveal]          fade + rise, batched and staggered as they enter
 *   [data-reveal-clip]     clip-path wipe from the bottom edge
 *   [data-parallax="n"]    drifts n% of its height while the section scrolls by
 *
 * Content is visible in the SSR HTML. Hidden start states are set from JS only,
 * and only when the visitor has not asked for reduced motion.
 */
export function ScrollReveal({ children, className }: { children: ReactNode; className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        const root = scope.current;
        if (!root) return;

        const rise = gsap.utils.toArray<HTMLElement>("[data-reveal]", root);
        if (rise.length) {
          gsap.set(rise, { autoAlpha: 0, y: 28 });
          const show = (batch: Element[]) =>
            gsap.to(batch, { autoAlpha: 1, y: 0, duration: 1, ease: "expo.out", stagger: 0.08, overwrite: true });
          // onLeave covers anchor jumps that land past an element before it ever "entered".
          ScrollTrigger.batch(rise, { start: "top 90%", once: true, onEnter: show, onLeave: show });
        }

        gsap.utils.toArray<HTMLElement>("[data-reveal-clip]", root).forEach((el) => {
          gsap.fromTo(
            el,
            { clipPath: "inset(0% 0% 100% 0% round 20px)" },
            {
              clipPath: "inset(0% 0% 0% 0% round 20px)",
              duration: 1.4,
              ease: "expo.out",
              scrollTrigger: { trigger: el, start: "top 85%", once: true },
            },
          );
        });

        gsap.utils.toArray<HTMLElement>("[data-parallax]", root).forEach((el) => {
          const amount = Number(el.dataset.parallax) || 10;
          gsap.fromTo(
            el,
            { yPercent: amount },
            { yPercent: -amount, ease: "none", scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: true } },
          );
        });
      });
      return () => mm.revert();
    },
    { scope },
  );

  return (
    <div ref={scope} className={className}>
      {children}
    </div>
  );
}
