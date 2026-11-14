"use client";

// A ring and a spray of particles in one colour: a dot that runs, and the orb when an answer
// lands. Decoration only (aria-hidden, no pointer events); callers skip it under reduced motion.
import { motion } from "motion/react";
import { burstParticles } from "./orb-play";

export interface Burst {
  id: number;
  /** Centre in px from the middle of the positioned parent. */
  x: number;
  y: number;
  /** The ring takes the first colour; particles cycle through them all. */
  hues: readonly string[];
  /** Spray radius (px). */
  radius: number;
  count: number;
}

export function Bursts({ items, onDone }: { items: readonly Burst[]; onDone: (id: number) => void }) {
  return items.map((b) => (
    <span key={b.id} aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 z-[45] size-0" style={{ transform: `translate(${b.x}px, ${b.y}px)` }}>
      <motion.span
        className="absolute rounded-full border-2"
        style={{ borderColor: b.hues[0], width: b.radius * 1.4, height: b.radius * 1.4, left: -b.radius * 0.7, top: -b.radius * 0.7 }}
        initial={{ scale: 0.15, opacity: 0.9 }}
        animate={{ scale: 1, opacity: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        onAnimationComplete={() => onDone(b.id)}
      />
      {burstParticles(b.count, b.id).map((p, i) => {
        const hue = b.hues[i % b.hues.length];
        return (
        <motion.span
          key={i}
          className="absolute rounded-full"
          style={{ width: p.size, height: p.size, left: -p.size / 2, top: -p.size / 2, background: hue, boxShadow: `0 0 8px ${hue}` }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.dx * b.radius, y: p.dy * b.radius, opacity: 0, scale: 0.3 }}
          transition={{ duration: 0.5, delay: p.delay, ease: [0.16, 1, 0.3, 1] }}
        />
        );
      })}
    </span>
  ));
}
