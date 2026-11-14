"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { OrbSignals } from "@/modules/ai/components/orb/OrbCore";
import type { OrbState } from "@/modules/ai/components/orb/orb-layout";

const OrbCore = dynamic(() => import("@/modules/ai/components/orb/OrbCore"), { ssr: false });

const ACCENT = ["#67d7ea", "#8b93ff"] as const;
const REST_TILT = -0.3;
/** Radians the orb turns per pixel dragged across it. */
const DRAG_TURN = 0.011;

interface Props {
  className?: string;
  /** Net density (orbNet). */
  freq: number;
  /** Sphere radius as a share of the square canvas. */
  share: number;
  state?: OrbState;
  /** Media query that must match for the live orb to mount; otherwise `fallback` shows. */
  query: string;
  /** "self": press and drag on the orb itself. "window": the orb sits behind other content and follows the mouse anywhere. */
  reach: "self" | "window";
  /** Radians turned per pixel of page scroll. */
  scrollTurn?: number;
  fallback?: ReactNode;
}

/**
 * The app's own net sphere (OrbCore) for the marketing pages: it lifts under the cursor, dents
 * where it is pressed, rings on release and turns when dragged or scrolled.
 */
export function LiveOrb({ className, freq, share, state = "idle", query, reach, scrollTurn = 0, fallback = null }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const signals = useRef<OrbSignals>({ level: 0, pulse: 0, spin: 0, tilt: REST_TILT, hot: [0, 0, 1, 0], shock: 0, ptr: [0, 0, 0], press: [0, 0, 0] });
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  const live = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );

  useEffect(() => {
    const el = host.current;
    if (!live || !el) return;
    const sig = signals.current;
    let dragged = 0;
    let lastX: number | null = null;
    /** Pointer position in the orb's own -1..1 square, y up. */
    const at = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const radius = r.width * share;
      return [(e.clientX - r.left - r.width / 2) / radius, (r.top + r.height / 2 - e.clientY) / radius] as const;
    };
    const turn = () => {
      sig.spin = dragged + window.scrollY * scrollTurn;
    };
    const onMove = (e: PointerEvent) => {
      if (reach === "window" && e.pointerType !== "mouse") return;
      const [x, y] = at(e);
      sig.ptr[0] = x;
      sig.ptr[1] = y;
      sig.ptr[2] = Math.hypot(x, y) < 1.05 ? 1 : 0;
      sig.tilt = REST_TILT - Math.max(-1.5, Math.min(1.5, y)) * 0.08;
      if (!sig.press[2]) return;
      sig.press[0] = x;
      sig.press[1] = y;
      if (lastX !== null) {
        dragged += (e.clientX - lastX) * DRAG_TURN;
        lastX = e.clientX;
        turn();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (reach === "window" && e.target instanceof Element && e.target.closest("a, button, video, input, summary")) return;
      const [x, y] = at(e);
      if (Math.hypot(x, y) > 1) return;
      sig.press[0] = x;
      sig.press[1] = y;
      sig.press[2] = 1;
      if (reach === "self") lastX = e.clientX;
    };
    const onUp = () => {
      sig.press[2] = 0;
      lastX = null;
    };
    turn();
    if (reach === "window") window.addEventListener("pointerdown", onDown);
    else el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    if (scrollTurn) window.addEventListener("scroll", turn, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("scroll", turn);
    };
  }, [live, reach, share, scrollTurn]);

  return (
    <div ref={host} className={className} aria-hidden>
      {live ? <OrbCore state={state} dark accent={ACCENT} signals={signals} freq={freq} share={share} /> : fallback}
    </div>
  );
}
