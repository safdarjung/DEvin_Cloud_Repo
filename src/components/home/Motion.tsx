"use client";

import { useEffect } from "react";

const COUNT_MS = 1100;

/** Counts an element's number up from zero once. The server-rendered text is the final value. */
function countUp(el: HTMLElement) {
  const target = Number(el.dataset.count);
  if (!Number.isFinite(target)) return;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / COUNT_MS);
    el.textContent = String(Math.round(target * (1 - (1 - t) ** 3)));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * Scroll motion for the sections after the opening film, as progressive enhancement: the page is complete
 * without it. Marks the page `data-motion` (home-motion.css then hides `[data-reveal]` elements that are
 * still below the fold), plays each one in as it scrolls into view and counts `[data-count]` numbers up.
 * Does nothing under reduced motion. Put `data-reveal` only on elements React keeps mounted: a remounted
 * element loses the `data-in` this sets and would stay hidden.
 */
export function Motion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lh");
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const items = [...root.querySelectorAll<HTMLElement>("[data-reveal], [data-count]")];
    // Whatever is already on screen stays as it is: no flash on load or after a jump to an anchor.
    for (const el of items) if (el.getBoundingClientRect().top < window.innerHeight) el.dataset.in = "now";
    root.dataset.motion = "on";
    const seen = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          seen.unobserve(el);
          if (el.dataset.in) continue;
          el.dataset.in = "true";
          if (el.dataset.count) countUp(el);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    items.forEach((el) => seen.observe(el));
    return () => {
      seen.disconnect();
      delete root.dataset.motion;
    };
  }, []);
  return <div className="lh-progress" aria-hidden="true" />;
}
