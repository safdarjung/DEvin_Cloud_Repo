"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Stands the hero's product screen up in 3D. Scroll lays it flat (`--flat`, 0 to 1) and a mouse
 * leans it (`--px`, `--py`); landing.css turns those into the transform. Without JS the screen
 * stays tilted; with reduced motion it starts flat.
 */
export function HeroTilt({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.dataset.flat = "";
      return;
    }
    let raf = 0;
    let px = 0;
    let py = 0;
    let tx = 0;
    let ty = 0;
    const frame = () => {
      raf = 0;
      const vh = window.innerHeight;
      const p = Math.min(1, Math.max(0, (vh * 0.66 - el.getBoundingClientRect().top) / (vh * 0.5)));
      const flat = p * p * (3 - 2 * p);
      px += (tx - px) * 0.12;
      py += (ty - py) * 0.12;
      const lean = 1 - flat * 0.8;
      el.style.setProperty("--flat", flat.toFixed(4));
      el.style.setProperty("--px", (px * lean).toFixed(4));
      el.style.setProperty("--py", (py * lean).toFixed(4));
      if (Math.abs(tx - px) + Math.abs(ty - py) > 0.002) raf = requestAnimationFrame(frame);
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || el.getBoundingClientRect().bottom < 0) return;
      tx = e.clientX / window.innerWidth - 0.5;
      ty = e.clientY / window.innerHeight - 0.5;
      kick();
    };
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("resize", kick);
    window.addEventListener("pointermove", onMove, { passive: true });
    kick();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", kick);
      window.removeEventListener("resize", kick);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div ref={stage} className="fos-hx__stage">
      <div className="fos-hx__tilt">{children}</div>
    </div>
  );
}
