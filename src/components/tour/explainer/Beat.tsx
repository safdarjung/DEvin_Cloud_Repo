import type { CSSProperties } from "react";
import { AbsoluteFill } from "remotion";
import type { TourFeature } from "../roles";
import { FeatureIcon } from "./icon";
import { Chip, INK, SCENE_H, SCENE_W, YELLOW, chunky, useMotion } from "./kit";
import { sceneKeyFor } from "./scene-map";
import { SCENES } from "./scenes";
import { LAYOUTS } from "./Stage";

const LABELS = { simulated: "Simulated", limited: "Limited" } as const;

/** Words pop up one after another instead of the line fading in as a block. */
export function Words({ text, from, step = 3, style }: { text: string; from: number; step?: number; style?: CSSProperties }) {
  const { pop } = useMotion();
  return (
    <span style={style}>
      {text.split(" ").map((w, i) => {
        const on = pop(from + i * step);
        return (
          <span key={i} style={{ display: "inline-block", marginRight: "0.26em", opacity: Math.min(1, on * 2), transform: `translateY(${(1 - on) * 0.7}em) scale(${0.7 + 0.3 * on})` }}>
            {w}
          </span>
        );
      })}
    </span>
  );
}

function Heading({ feature, accent, size }: { feature: TourFeature; accent: string; size: number }) {
  const { frame, pop } = useMotion();
  const icon = pop(4, { damping: 7, stiffness: 170, mass: 0.7 });
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
        <div style={{ ...chunky(24, 7), width: 84, height: 84, flex: "none", background: accent, display: "grid", placeItems: "center", transform: `scale(${icon}) rotate(${(1 - icon) * -40 + Math.sin(frame / 7) * 3}deg)` }}>
          <FeatureIcon name={feature.icon} size={50} color="#fff" strokeWidth={2.6} />
        </div>
        {feature.label && (
          <Chip color={YELLOW} size={28} style={{ transform: `scale(${pop(14)}) rotate(-3deg)`, textTransform: "uppercase", letterSpacing: 1 }}>
            {LABELS[feature.label]}
          </Chip>
        )}
      </div>
      <h2 style={{ fontSize: feature.title.length > 20 ? size - 10 : size, lineHeight: 1.06, margin: 0, color: INK, fontWeight: 900 }}>
        <Words text={feature.title} from={10} />
      </h2>
    </>
  );
}

const BLURB: CSSProperties = { fontSize: 34, lineHeight: 1.3, margin: 0, fontWeight: 700, color: "#374151" };

function SceneBox({ feature, accent, left, top, scale = 1, from }: { feature: TourFeature; accent: string; left: number; top: number; scale?: number; from: "right" | "left" | "bottom" }) {
  const { frame, pop } = useMotion();
  const on = pop(6, { damping: 12, stiffness: 120, mass: 0.8 });
  const off = (1 - on) * 420;
  const shift = from === "right" ? `${off}px, 0` : from === "left" ? `${-off}px, 0` : `0, ${off}px`;
  const Scene = SCENES[sceneKeyFor(feature)];
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: SCENE_W,
        height: SCENE_H,
        transformOrigin: "left top",
        transform: `translate(${shift}) scale(${scale * (0.85 + 0.15 * on)}) rotate(${(1 - on) * (from === "left" ? -8 : 8) + Math.sin(frame / 30) * 0.6}deg)`,
        opacity: Math.min(1, on * 3),
      }}
    >
      <Scene accent={accent} />
    </div>
  );
}

export function Beat({ feature, index, accent }: { feature: TourFeature; index: number; accent: string }) {
  const { pop } = useMotion();
  const layout = index % LAYOUTS;
  const blurb = pop(24);
  if (layout === 2) {
    return (
      <AbsoluteFill>
        <div style={{ position: "absolute", left: 80, top: 44, right: 80 }}>
          <Heading feature={feature} accent={accent} size={66} />
        </div>
        <SceneBox feature={feature} accent={accent} left={80} top={236} scale={1.08} from="bottom" />
        <div style={{ ...chunky(30, 8), position: "absolute", left: 690, top: 240, width: 510, padding: "20px 26px", borderBottomRightRadius: 6, transformOrigin: "80% 100%", transform: `scale(${blurb})` }}>
          <p style={BLURB}>{feature.blurb}</p>
        </div>
      </AbsoluteFill>
    );
  }
  const textLeft = layout === 0;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: textLeft ? 80 : 690, width: textLeft ? 520 : 520, top: 60, height: 560, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Heading feature={feature} accent={accent} size={66} />
        <p style={{ ...BLURB, marginTop: 18, opacity: Math.min(1, blurb * 1.5), transform: `translateY(${(1 - blurb) * 30}px)` }}>{feature.blurb}</p>
      </div>
      <SceneBox feature={feature} accent={accent} left={textLeft ? 640 : 64} top={textLeft ? 134 : 154} scale={1.2} from={textLeft ? "right" : "left"} />
    </AbsoluteFill>
  );
}
