import { AbsoluteFill, Sequence } from "remotion";
import type { TourRole } from "../roles";
import { Beat, Words } from "./Beat";
import { FeatureIcon } from "./icon";
import { FilmAudio } from "./FilmAudio";
import { Chip, FONT, INK, YELLOW, chunky, useMotion } from "./kit";
import { Backdrop, MascotLayer, ProgressPill, Wipes } from "./Stage";
import { explainerTimeline } from "./timeline";

export interface RoleExplainerProps extends Record<string, unknown> {
  role: TourRole;
}

function TitleCard({ role }: { role: TourRole }) {
  const { pop } = useMotion();
  const chip = pop(10);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 520, right: 70, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start" }}>
        <Chip color={role.accent} size={28} style={{ color: "#fff", transform: `scale(${chip}) rotate(${(1 - chip) * -20 - 3}deg)`, textTransform: "uppercase", letterSpacing: 1 }}>
          {role.room}
        </Chip>
        <h1 style={{ fontSize: role.label.length > 10 ? 92 : 128, margin: "18px 0 14px", color: INK, fontWeight: 900, lineHeight: 1, whiteSpace: "nowrap" }}>
          {[...role.label].map((ch, i) => {
            const on = pop(14 + i * 2);
            return (
              <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - on) * 80}px) scale(${on}, ${2 - on})` }}>
                {ch}
              </span>
            );
          })}
        </h1>
        <p style={{ fontSize: 36, lineHeight: 1.3, fontWeight: 700, color: "#374151", margin: 0 }}>
          <Words text={role.tagline} from={32} step={2} />
        </p>
      </div>
    </AbsoluteFill>
  );
}

const CONFETTI = Array.from({ length: 14 }, (_, i) => ({ angle: (i / 14) * Math.PI * 2 + 0.3, reach: 250 + ((i * 53) % 140), size: 16 + ((i * 7) % 14) }));

function EndCard({ role }: { role: TourRole }) {
  const { frame, pop, ramp } = useMotion();
  const cta = pop(26, { damping: 8, stiffness: 170, mass: 0.7 });
  const tap = 1 - 0.07 * Math.max(0, Math.sin((frame - 50) / 6)) ** 6;
  const burst = ramp(26, 62);
  return (
    <AbsoluteFill>
      {CONFETTI.map((c, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: 640 + Math.cos(c.angle) * c.reach * (1 - (1 - burst) ** 3),
            top: 470 + Math.sin(c.angle) * c.reach * 0.6 * (1 - (1 - burst) ** 3) + burst * burst * 60,
            width: c.size,
            height: c.size,
            borderRadius: i % 2 ? "50%" : 5,
            border: `3px solid ${INK}`,
            background: [role.accent, YELLOW, "#fff"][i % 3],
            opacity: burst > 0 ? 1 - burst ** 4 : 0,
            transform: `rotate(${frame * (6 + i)}deg)`,
          }}
        />
      ))}
      <h2 style={{ position: "absolute", left: 0, right: 0, top: 310, textAlign: "center", fontSize: 72, color: INK, fontWeight: 900, margin: 0 }}>
        <Words text="Ready to look around?" from={12} />
      </h2>
      <div style={{ position: "absolute", left: 0, right: 0, top: 424, display: "grid", placeItems: "center" }}>
        <div style={{ ...chunky(999, 12 * tap), padding: "22px 60px", background: role.accent, color: "#fff", fontSize: 56, fontWeight: 900, transform: `scale(${cta * tap}) translateY(${(1 - tap) * 60}px)` }}>
          Try the {role.label} demo
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 590, display: "flex", justifyContent: "center", gap: 16 }}>
        {role.features.map((f, i) => (
          <div key={f.title} style={{ ...chunky(18, 6), width: 64, height: 64, display: "grid", placeItems: "center", transform: `scale(${pop(40 + i * 4)}) rotate(${i % 2 ? 5 : -5}deg)` }}>
            <FeatureIcon name={f.icon} size={34} color={INK} strokeWidth={2.6} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function RoleExplainer({ role }: RoleExplainerProps) {
  const t = explainerTimeline(role.features.length);
  return (
    <AbsoluteFill className="tour-explainer" style={{ fontFamily: FONT }}>
      {/* The app's CSS reset is not present in the MP4 render page, so pin the box model here. */}
      <style>{".tour-explainer *{box-sizing:border-box}"}</style>
      <Backdrop accent={role.accent} />
      <Sequence from={t.title.from} durationInFrames={t.title.duration}>
        <TitleCard role={role} />
      </Sequence>
      {role.features.map((f, i) => (
        <Sequence key={f.title} from={t.beats[i].from} durationInFrames={t.beats[i].duration}>
          <Beat feature={f} index={i} accent={role.accent} />
        </Sequence>
      ))}
      <Sequence from={t.end.from} durationInFrames={t.end.duration}>
        <EndCard role={role} />
      </Sequence>
      <Wipes accent={role.accent} cuts={t.cuts} />
      <ProgressPill accent={role.accent} count={role.features.length} />
      <MascotLayer role={role} />
      <FilmAudio filmId={`role-${role.key}`} />
    </AbsoluteFill>
  );
}
