import type { CSSProperties, ReactNode } from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export const INK = "#1F2937";
export const PAPER = "#FFF8EC";
export const MUTED = "#EEE7D8";
export const GREEN = "#22C55E";
export const RED = "#EF4444";
export const YELLOW = "#FFD84D";
export const FONT = 'var(--font-jakarta, "Nunito"), "Segoe UI", system-ui, sans-serif';
export const SCENE_W = 480;
export const SCENE_H = 350;

export interface SpringCfg {
  damping: number;
  stiffness: number;
  mass: number;
}
export const BOUNCY: SpringCfg = { damping: 9, stiffness: 150, mass: 0.7 };
export const SNAPPY: SpringCfg = { damping: 14, stiffness: 160, mass: 0.7 };

/** Frame-relative helpers for a scene: `pop(delay)` is an overshoot spring, `ramp(a,b)` a clamped 0..1, `count(a,b)` the same but slowing into 1 (numbers that settle). */
export function useMotion() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = (delay = 0, config: SpringCfg = BOUNCY) => spring({ frame: frame - delay, fps, config });
  const ramp = (from: number, to: number) =>
    interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const count = (from: number, to: number) => 1 - (1 - ramp(from, to)) ** 3;
  return { frame, pop, ramp, count };
}

/** A pointer glides to (x, y) in the scene, presses at frame `at` and leaves a ring in the accent: it shows what is being tapped. */
export function Tap({ x, y, at, accent }: { x: number; y: number; at: number; accent: string }) {
  const { frame, pop, ramp } = useMotion();
  const come = pop(at - 22, SNAPPY);
  const press = Math.sin(ramp(at - 3, at + 7) * Math.PI);
  const ring = ramp(at, at + 16);
  const gone = ramp(at + 26, at + 36);
  if (frame < at - 22 || gone >= 1) return null;
  return (
    <>
      <span
        style={{ position: "absolute", left: x - 30, top: y - 30, width: 60, height: 60, borderRadius: "50%", border: `5px solid ${accent}`, opacity: ring > 0 ? 1 - ring : 0, transform: `scale(${0.3 + ring * 1.2})` }}
      />
      <svg
        width={38}
        height={44}
        viewBox="0 0 19 22"
        style={{ position: "absolute", left: x - 3 + (1 - come) * 150, top: y - 3 + (1 - come) * 110, opacity: Math.min(1, come * 3) * (1 - gone), transform: `scale(${1 - 0.18 * press})`, transformOrigin: "0 0" }}
      >
        <path d="M1.5 1.5v15.2l4.2-3.6 2.7 6.2 3-1.3-2.7-6.1h5.6z" fill="#fff" stroke={INK} strokeWidth={2.2} strokeLinejoin="round" />
      </svg>
    </>
  );
}

export const chunky = (radius = 28, lift = 8): CSSProperties => ({
  border: `4px solid ${INK}`,
  borderRadius: radius,
  boxShadow: `0 ${lift}px 0 ${INK}`,
  background: "#fff",
});

/** Indian-style number grouping with the rupee sign: 14500 -> ₹14,500. */
export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function Chip({
  children,
  color = "#fff",
  size = 22,
  style,
}: {
  children: ReactNode;
  color?: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: `${size * 0.22}px ${size * 0.7}px`,
        borderRadius: 999,
        border: `3px solid ${INK}`,
        background: color,
        color: INK,
        fontWeight: 900,
        fontSize: size,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** The white chunky card every mini scene sits in. */
export function Panel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        ...chunky(32, 10),
        position: "absolute",
        inset: 0,
        bottom: 10,
        padding: 18,
        overflow: "hidden",
        color: INK,
        fontWeight: 800,
        fontSize: 24,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function PanelHead({ title, accent, right }: { title: string; accent: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <span style={{ width: 20, height: 20, borderRadius: 7, background: accent, border: `3px solid ${INK}` }} />
      <span style={{ fontSize: 26, fontWeight: 900, flex: 1 }}>{title}</span>
      {right}
    </div>
  );
}

/** Round tick / cross badge that pops in. */
export function Mark({ on, ok = true, size = 40 }: { on: number; ok?: boolean; size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: "50%",
        border: `3px solid ${INK}`,
        background: ok ? GREEN : RED,
        display: "grid",
        placeItems: "center",
        transform: `scale(${on})`,
      }}
    >
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round">
        {ok ? <path d="M4 12.5l5 5L20 6.5" /> : <path d="M6 6l12 12M18 6L6 18" />}
      </svg>
    </span>
  );
}

/** Grey placeholder line used where real text would be a made-up name. */
export function Bar({ w, h = 14, color = MUTED }: { w: number | string; h?: number; color?: string }) {
  return <span style={{ display: "block", width: w, height: h, borderRadius: h, background: color }} />;
}

/** A list row that slides in from the right with a spring. */
export function Row({ on, children, style }: { on: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "10px 14px",
        borderRadius: 18,
        border: `3px solid ${INK}`,
        background: PAPER,
        opacity: Math.min(1, on * 1.6),
        transform: `translateX(${(1 - on) * 80}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
