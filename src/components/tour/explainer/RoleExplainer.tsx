import type { CSSProperties } from "react";
import {
  AbsoluteFill,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { TourFeature, TourRole } from "../roles";
import { FeatureIcon } from "./icon";
import { explainerTimeline } from "./timeline";

const INK = "#1F2937";
const PAPER = "#FFF8EC";
interface SpringCfg {
  damping: number;
  stiffness: number;
  mass: number;
}
const BOUNCY: SpringCfg = { damping: 9, stiffness: 150, mass: 0.7 };
const FONT = '"Nunito", "Segoe UI", system-ui, sans-serif';

export interface RoleExplainerProps extends Record<string, unknown> {
  role: TourRole;
}

function usePop(delay = 0, config: SpringCfg = BOUNCY) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config });
}

const chunky = (): CSSProperties => ({
  border: `5px solid ${INK}`,
  borderRadius: 36,
  boxShadow: `0 10px 0 ${INK}`,
  background: "#fff",
});

function Backdrop({ accent }: { accent: string }) {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 25) * 14;
  const blob = (size: number, x: number, y: number, o: number): CSSProperties => ({
    position: "absolute",
    width: size,
    height: size,
    borderRadius: "50%",
    background: accent,
    opacity: o,
    left: x,
    top: y + drift,
  });
  return (
    <AbsoluteFill style={{ background: PAPER, fontFamily: FONT, overflow: "hidden" }}>
      <div style={blob(520, -160, -200, 0.16)} />
      <div style={blob(360, 1000, 480, 0.22)} />
      <div style={blob(160, 1100, 40, 0.3)} />
    </AbsoluteFill>
  );
}

function Chip({ text, color, scale = 1 }: { text: string; color: string; scale?: number }) {
  return (
    <span
      style={{
        display: "inline-block",
        transform: `scale(${scale})`,
        padding: "8px 22px",
        borderRadius: 999,
        border: `4px solid ${INK}`,
        background: color,
        color: INK,
        fontWeight: 900,
        fontSize: 28,
        letterSpacing: 1,
        textTransform: "uppercase",
      }}
    >
      {text}
    </span>
  );
}

function TitleCard({ role }: { role: TourRole }) {
  const pop = usePop(4);
  const sub = usePop(18);
  const wiggle = Math.sin(useCurrentFrame() / 4) * 2;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <div style={{ transform: `scale(${pop}) rotate(${wiggle}deg)` }}>
        <Chip text={role.room} color={role.accent} />
        <h1 style={{ fontSize: 150, margin: "20px 0 0", color: INK, fontWeight: 900, lineHeight: 1 }}>
          {role.label}
        </h1>
      </div>
      <p
        style={{
          fontSize: 38,
          fontWeight: 700,
          color: INK,
          maxWidth: 900,
          marginTop: 28,
          opacity: Math.min(1, sub),
          transform: `translateY(${(1 - sub) * 40}px)`,
        }}
      >
        {role.tagline}
      </p>
    </AbsoluteFill>
  );
}

/** Small animated mock: bars that grow in, so every beat has something moving. */
function MockTile({ accent, seed }: { accent: string; seed: number }) {
  const rows = [0.9, 0.62, 0.78].map((w, i) => ({ w: ((w * 100 + seed * 7 + i * 11) % 45) + 45, i }));
  return (
    <div style={{ ...chunky(), padding: 28, width: 440, display: "grid", gap: 18 }}>
      {rows.map(({ w, i }) => (
        <MockRow key={i} width={w} delay={22 + i * 8} accent={accent} />
      ))}
    </div>
  );
}

function MockRow({ width, delay, accent }: { width: number; delay: number; accent: string }) {
  const grow = usePop(delay, { damping: 14, stiffness: 120, mass: 0.8 });
  return (
    <div style={{ height: 34, borderRadius: 17, background: "#EEE7D8", overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          width: `${width * Math.min(grow, 1.05)}%`,
          background: accent,
          borderRadius: 17,
          borderRight: `4px solid ${INK}`,
        }}
      />
    </div>
  );
}

function Beat({
  feature,
  index,
  total,
  accent,
}: {
  feature: TourFeature;
  index: number;
  total: number;
  accent: string;
}) {
  const frame = useCurrentFrame();
  const icon = usePop(2, { damping: 7, stiffness: 170, mass: 0.7 });
  const text = usePop(12);
  const blurb = usePop(20);
  const mock = usePop(26);
  const tilt = Math.sin(frame / 6) * 3 * Math.min(1, icon);
  const labelText = feature.label === "simulated" ? "Simulated" : feature.label === "limited" ? "Limited" : null;
  return (
    <AbsoluteFill style={{ flexDirection: "row", alignItems: "center", padding: "0 80px", gap: 56 }}>
      <div
        style={{
          ...chunky(),
          width: 250,
          height: 250,
          flex: "none",
          background: accent,
          display: "grid",
          placeItems: "center",
          transform: `scale(${icon}) rotate(${tilt}deg)`,
        }}
      >
        <FeatureIcon name={feature.icon} size={140} color="#fff" strokeWidth={2.6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", opacity: Math.min(1, text) }}>
          <Chip text={`${index + 1} / ${total}`} color="#fff" />
          {labelText && <Chip text={labelText} color="#FFD84D" scale={Math.min(1, text)} />}
        </div>
        <h2
          style={{
            fontSize: 84,
            lineHeight: 1.05,
            margin: "18px 0 10px",
            color: INK,
            fontWeight: 900,
            transform: `translateX(${(1 - text) * -120}px)`,
            opacity: Math.min(1, text),
          }}
        >
          {feature.title}
        </h2>
        <p
          style={{
            fontSize: 38,
            lineHeight: 1.3,
            margin: 0,
            fontWeight: 700,
            color: "#374151",
            maxWidth: 720,
            opacity: Math.min(1, blurb),
            transform: `translateY(${(1 - blurb) * 30}px)`,
          }}
        >
          {feature.blurb}
        </p>
        <div style={{ marginTop: 30, transform: `scale(${mock})`, transformOrigin: "left top" }}>
          <MockTile accent={accent} seed={index} />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function EndCard({ role }: { role: TourRole }) {
  const frame = useCurrentFrame();
  const pop = usePop(4);
  const pulse = 1 + Math.sin(frame / 5) * 0.03;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <h2 style={{ fontSize: 96, color: INK, fontWeight: 900, margin: 0, transform: `scale(${pop})` }}>
        Ready to look around?
      </h2>
      <div
        style={{
          marginTop: 44,
          transform: `scale(${Math.min(1, pop) * pulse})`,
          padding: "26px 64px",
          borderRadius: 999,
          border: `6px solid ${INK}`,
          boxShadow: `0 12px 0 ${INK}`,
          background: role.accent,
          color: "#fff",
          fontSize: 60,
          fontWeight: 900,
        }}
      >
        Try the {role.label} demo
      </div>
    </AbsoluteFill>
  );
}

export function RoleExplainer({ role }: RoleExplainerProps) {
  const t = explainerTimeline(role.features.length);
  return (
    <AbsoluteFill>
      <Backdrop accent={role.accent} />
      <Sequence from={t.title.from} durationInFrames={t.title.duration} premountFor={10}>
        <TitleCard role={role} />
      </Sequence>
      {role.features.map((f, i) => (
        <Sequence key={f.title} from={t.beats[i].from} durationInFrames={t.beats[i].duration} premountFor={10}>
          <Beat feature={f} index={i} total={role.features.length} accent={role.accent} />
        </Sequence>
      ))}
      <Sequence from={t.end.from} durationInFrames={t.end.duration} premountFor={10}>
        <EndCard role={role} />
      </Sequence>
    </AbsoluteFill>
  );
}
