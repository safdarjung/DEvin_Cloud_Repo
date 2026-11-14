// Small drawing pieces shared by the film's sections: yarn strokes, paper tags, the cut wipes and the wordmark.
import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { INK, YELLOW, chunky } from "../../tour/explainer/kit";
import { THREADS } from "../story";
import { FILM_WIPE } from "./film-timeline";

export const BRAND = "#0A72EF"; // --mk-accent, the marketing site's wordmark colour
const BRAND_HALF = "#85B9F7"; // BRAND at 50% on white, solid so the ink outline stays full strength

/** Polyline through y = f(x) from x0 to x1; dense enough that a thick round-joined stroke reads as a curve. */
export function wave(f: (x: number) => number, x0: number, x1: number, step = 14): string {
  const n = Math.max(1, Math.ceil(Math.abs(x1 - x0) / step));
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const x = x0 + ((x1 - x0) * i) / n;
    return `${x.toFixed(1)} ${f(x).toFixed(1)}`;
  });
  return `M${pts.join(" L")}`;
}

/** A strand of yarn: ink outline, the colour, and a dashed light twist on top. */
export function Yarn({ d, color, width = 14, cap = "round" }: { d: string; color: string; width?: number; cap?: "round" | "butt" }) {
  return (
    <>
      <path d={d} fill="none" stroke={INK} strokeWidth={width + 8} strokeLinecap={cap} strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap={cap} strokeLinejoin="round" />
      <path d={d} fill="none" stroke="#fff" strokeOpacity={0.35} strokeWidth={width * 0.28} strokeDasharray={`${width * 0.5} ${width * 0.9}`} strokeLinecap="round" />
    </>
  );
}

/** A paper luggage tag with a punched hole, hung by a short string from its top centre. */
export function Tag({ children, color, width, size, style }: { children: ReactNode; color: string; width: number; size: number; style?: CSSProperties }) {
  return (
    <div style={{ position: "absolute", width, transformOrigin: "50% 0", ...style }}>
      <div style={{ width: 4, height: size * 1.4, margin: "0 auto", background: INK }} />
      <div style={{ ...chunky(size * 0.6, size * 0.3), borderTop: `${size * 0.4}px solid ${color}`, padding: `${size * 0.35}px ${size * 0.45}px ${size * 0.45}px`, position: "relative", textAlign: "center", fontSize: size, fontWeight: 900, lineHeight: 1.15, color: INK }}>
        <span style={{ position: "absolute", left: "50%", top: -size * 0.32, width: size * 0.5, height: size * 0.5, marginLeft: -size * 0.25, borderRadius: "50%", background: "#fff", border: `3px solid ${INK}` }} />
        {children}
      </div>
    </div>
  );
}

/** Coloured panels sweep across every cut so sections never hard-switch; colour and direction rotate per cut. */
export function FilmWipes({ cuts }: { cuts: readonly number[] }) {
  const frame = useCurrentFrame();
  const k = cuts.findIndex((c) => Math.abs(frame - c) <= FILM_WIPE + 3);
  if (k < 0) return null;
  const at = (lag: number) => {
    const t = interpolate(frame - cuts[k] - lag, [-FILM_WIPE, FILM_WIPE], [-1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return Math.sign(t) * Math.abs(t) ** 1.7 * 135;
  };
  const move = [
    (p: number) => `rotate(-8deg) translateX(${p}%)`,
    (p: number) => `rotate(6deg) translateY(${-p}%)`,
    (p: number) => `rotate(8deg) translateX(${-p}%)`,
  ][k % 3];
  const panel = (color: string, lag: number) => <div style={{ position: "absolute", inset: "-30%", background: color, borderRadius: 80, transform: move(at(lag)) }} />;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {panel(INK, -3)}
      {panel(YELLOW, -1.5)}
      {panel(THREADS[(k * 3) % THREADS.length].color, 0)}
    </AbsoluteFill>
  );
}

/** The Fabric mark: a 2x2 woven square (two full squares, two half-tone), as in the site header. */
export function WovenMark({ size, on = 1 }: { size: number; on?: number }) {
  const cell = (color: string, i: number) => (
    <span key={i} style={{ background: color, borderRadius: size * 0.08, border: `${Math.max(3, size * 0.03)}px solid ${INK}`, opacity: Math.min(1, on * 2), transform: `scale(${on}) rotate(${(1 - on) * (i % 2 ? 30 : -30)}deg)` }} />
  );
  return (
    <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: size * 0.05, width: size, height: size, flex: "none" }}>
      {[BRAND, BRAND_HALF, BRAND_HALF, BRAND].map(cell)}
    </span>
  );
}
