import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { TourRole } from "../roles";
import { BOUNCY, FONT, INK, PAPER, YELLOW } from "./kit";
import { MASCOT_H, MASCOT_W, Mascot } from "./Mascot";
import { WIPE_FRAMES, explainerTimeline } from "./timeline";

export const LAYOUTS = 3;

interface Pose {
  x: number; // centre of the feet, composition pixels
  y: number;
  scale: number;
  lookX: number;
  lookY: number;
}
const TITLE_POSE: Pose = { x: 290, y: 560, scale: 1.55, lookX: 0.6, lookY: 0 };
const END_POSE: Pose = { x: 640, y: 296, scale: 1.05, lookX: 0, lookY: 0.7 };
/** Where the mascot stands in each beat layout (see Beat.tsx): sitting on the scene (right side, then left side), then beside a speech bubble. */
const BEAT_POSES: readonly Pose[] = [
  { x: 724, y: 146, scale: 0.58, lookX: 0.5, lookY: 0.9 },
  { x: 150, y: 166, scale: 0.58, lookX: 0.6, lookY: 0.8 },
  { x: 1020, y: 652, scale: 0.95, lookX: -0.9, lookY: -0.2 },
];

export function Backdrop({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const blob = (size: number, x: number, y: number, o: number, phase: number) => (
    <div
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: "50%",
        background: accent,
        opacity: o,
        left: x + Math.cos(frame / 40 + phase) * 18,
        top: y + Math.sin(frame / 28 + phase) * 16,
      }}
    />
  );
  return (
    <AbsoluteFill style={{ background: PAPER, overflow: "hidden" }}>
      {blob(520, -180, -220, 0.14, 0)}
      {blob(380, 1010, 470, 0.18, 2)}
      {blob(150, 1090, 30, 0.26, 4)}
      {blob(90, 120, 600, 0.2, 1)}
    </AbsoluteFill>
  );
}

/** An accent panel sweeps across at every cut so sections never hard-switch; direction rotates. */
export function Wipes({ accent, cuts }: { accent: string; cuts: readonly number[] }) {
  const frame = useCurrentFrame();
  const k = cuts.findIndex((c) => Math.abs(frame - c) <= WIPE_FRAMES + 3);
  if (k < 0) return null;
  const at = (lag: number) => {
    const t = interpolate(frame - cuts[k] - lag, [-WIPE_FRAMES, WIPE_FRAMES], [-1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return Math.sign(t) * Math.abs(t) ** 1.7 * 135;
  };
  const move = [
    (p: number) => `rotate(-8deg) translateX(${p}%)`,
    (p: number) => `rotate(6deg) translateY(${-p}%)`,
    (p: number) => `rotate(8deg) translateX(${-p}%)`,
  ][k % 3];
  const panel = (color: string, lag: number) => (
    <div style={{ position: "absolute", inset: "-30%", background: color, borderRadius: 80, transform: move(at(lag)) }} />
  );
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {panel(INK, -3)}
      {panel(YELLOW, -1.5)}
      {panel(accent, 0)}
    </AbsoluteFill>
  );
}

export function ProgressPill({ accent, count }: { accent: string; count: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = explainerTimeline(count);
  if (count === 0) return null;
  const show = spring({ frame: frame - t.beats[0].from, fps, config: BOUNCY }) - spring({ frame: frame - t.end.from + 4, fps, config: { damping: 20, stiffness: 200, mass: 0.6 } });
  return (
    <div
      style={{
        position: "absolute",
        left: 820,
        width: 380,
        top: 26,
        display: "flex",
        gap: 8,
        padding: 8,
        borderRadius: 999,
        border: `4px solid ${INK}`,
        background: "#fff",
        boxShadow: `0 6px 0 ${INK}`,
        transform: `translateY(${(1 - show) * -90}px)`,
      }}
    >
      {t.beats.map((b) => {
        const fill = interpolate(frame, [b.from, b.from + b.duration], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const active = frame >= b.from && frame < b.from + b.duration;
        return (
          <span key={b.from} style={{ flex: active ? 2.2 : 1, height: 16, borderRadius: 8, background: "#EEE7D8", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${fill * 100}%`, borderRadius: 8, background: accent }} />
          </span>
        );
      })}
    </div>
  );
}

/** The one element that lives through the whole film: it hops from spot to spot over each wipe. */
export function MascotLayer({ role }: { role: TourRole }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = explainerTimeline(role.features.length);
  const targets = [...role.features.map((_, i) => BEAT_POSES[i % LAYOUTS]), END_POSE];
  let pose = TITLE_POSE;
  let air = 0;
  t.cuts.forEach((cut, i) => {
    const s = spring({ frame: frame - (cut - WIPE_FRAMES), fps, config: { damping: 11, stiffness: 110, mass: 0.8 } });
    const to = targets[i];
    const mix = (a: number, b: number) => a + (b - a) * s;
    pose = { x: mix(pose.x, to.x), y: mix(pose.y, to.y), scale: mix(pose.scale, to.scale), lookX: mix(pose.lookX, to.lookX), lookY: mix(pose.lookY, to.lookY) };
    air += Math.sin(Math.min(1, Math.max(0, s)) * Math.PI);
  });
  const entry = spring({ frame: frame - 6, fps, config: BOUNCY });
  const idle = Math.sin(frame / 9) * 0.025;
  const section = t.cuts.filter((c) => frame >= c).length; // 0 title, 1..n beats, n+1 end
  const isBeat = section >= 1 && section <= role.features.length;
  const wave = section === 0 || !isBeat ? Math.min(1, Math.max(0, (frame - (section === 0 ? 20 : t.end.from + 12)) / 10)) : 0;
  return (
    <div
      style={{
        position: "absolute",
        left: pose.x - MASCOT_W / 2,
        top: pose.y - MASCOT_H - air * 90,
        width: MASCOT_W,
        height: MASCOT_H,
        transformOrigin: "50% 100%",
        transform: `scale(${pose.scale * entry * (1 - air * 0.12 - idle)}, ${pose.scale * entry * (1 + air * 0.2 + idle)}) rotate(${air * 10}deg)`,
        fontFamily: FONT,
      }}
    >
      <Mascot
        role={role.key}
        accent={role.accent}
        frame={frame}
        wave={wave}
        lookX={pose.lookX}
        lookY={pose.lookY}
        talking={isBeat && (section - 1) % LAYOUTS === 2 && air < 0.05 && frame - t.beats[section - 1].from < 100}
      />
    </div>
  );
}
