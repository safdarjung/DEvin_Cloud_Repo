// Film section 4: follow one thread ("Absent today", STORIES[0]) through five people, then its outcome.
import { AbsoluteFill } from "remotion";
import { Words } from "../../tour/explainer/Beat";
import { FeatureIcon } from "../../tour/explainer/icon";
import { Chip, INK, SCENE_H, SCENE_W, YELLOW, chunky, useMotion } from "../../tour/explainer/kit";
import { Mascot } from "../../tour/explainer/Mascot";
import { SCENES } from "../../tour/explainer/scenes";
import { HONESTY_TEXT, PEOPLE, STORIES, THREAD } from "../story";
import { Yarn, wave } from "./film-kit";

export const STORY = STORIES[0];
const GREEN_THREAD = THREAD[STORY.thread].color;

export function StoryTitleScene() {
  const { frame, pop } = useMotion();
  const chip = pop(4);
  return (
    <AbsoluteFill>
      <svg width={1280} height={720} style={{ position: "absolute", inset: 0 }}>
        <Yarn d={wave((x) => 560 + Math.sin(x / 140 + frame / 10) * 26, -40, -40 + 1360 * Math.min(1, frame / 30))} color={GREEN_THREAD} width={18} />
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: 140, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Chip color={GREEN_THREAD} size={30} style={{ color: "#fff", textShadow: `0 2px 0 ${INK}`, transform: `scale(${chip}) rotate(-3deg)` }}>
          Follow one thread
        </Chip>
        <h2 style={{ margin: "22px 0 10px", fontSize: 128, lineHeight: 1, fontWeight: 900, color: INK, whiteSpace: "nowrap" }}>
          {[...STORY.title].map((ch, i) => {
            const on = pop(8 + i * 2);
            return (
              <span key={i} style={{ display: "inline-block", minWidth: ch === " " ? "0.3em" : undefined, transform: `translateY(${(1 - on) * 80}px) scale(${on}, ${2 - on})` }}>
                {ch}
              </span>
            );
          })}
        </h2>
        <p style={{ margin: 0, fontSize: 40, fontWeight: 700, color: "#374151" }}>
          <Words text={STORY.question} from={24} step={2} />
        </p>
      </div>
    </AbsoluteFill>
  );
}

const SCALE = 1.18;

/** The green thread along the bottom: one knot per step, drawn up to the current step. */
function StoryThread({ index }: { index: number }) {
  const { ramp, pop } = useMotion();
  const knotX = (k: number) => 140 + k * 250;
  const reach = knotX(Math.max(0, index - 1)) + (knotX(index) - knotX(Math.max(0, index - 1))) * (1 - (1 - ramp(6, 34)) ** 3);
  return (
    <>
      <svg width={1280} height={720} style={{ position: "absolute", inset: 0 }}>
        <Yarn d={wave((x) => 664 + Math.sin(x / 60) * 5, 60, Math.max(62, reach))} color={GREEN_THREAD} width={12} />
      </svg>
      {STORY.steps.map((s, k) => {
        const on = k < index ? 1 : k === index ? pop(30) : 0;
        const p = PEOPLE[s.who];
        return (
          <span key={k} style={{ position: "absolute", left: knotX(k) - 22, top: 642, width: 44, height: 44, borderRadius: "50%", border: `4px solid ${INK}`, background: k <= index ? p.accent : "#fff", transform: `scale(${k === index ? 0.6 + 0.6 * on : 1})`, display: "grid", placeItems: "center" }}>
            <FeatureIcon name={s.icon} size={20} color={k <= index ? "#fff" : INK} strokeWidth={3} />
          </span>
        );
      })}
    </>
  );
}

export function StoryStepScene({ index }: { index: number }) {
  const { frame, pop } = useMotion();
  const step = STORY.steps[index];
  const person = PEOPLE[step.who];
  const Scene = SCENES[step.scene];
  const textLeft = index % 2 === 0;
  const scene = pop(4, { damping: 12, stiffness: 120, mass: 0.8 });
  const blurb = pop(30);
  const peek = pop(22, { damping: 8, stiffness: 140, mass: 0.7 });
  const sceneLeft = textLeft ? 670 : 60;
  const sceneTop = 150;
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: sceneLeft,
          top: sceneTop,
          width: SCENE_W,
          height: SCENE_H,
          transformOrigin: "left top",
          transform: `translateX(${(1 - scene) * (textLeft ? 500 : -500)}px) scale(${SCALE * (0.85 + 0.15 * scene)}) rotate(${(1 - scene) * (textLeft ? 8 : -8) + Math.sin(frame / 30) * 0.6}deg)`,
        }}
      >
        <Scene accent={person.accent} />
      </div>
      {/* Stands on the scene's top edge (feet on the outline), clear of the panel's header row. */}
      <div style={{ position: "absolute", left: sceneLeft + (textLeft ? SCENE_W * SCALE - 150 : 30), top: sceneTop - 128 + (1 - peek) * 100, width: 120, height: 132, opacity: Math.min(1, peek * 3) }}>
        <div style={{ transform: "scale(0.6)", transformOrigin: "left top" }}>
          <Mascot role={person.tour} accent={person.accent} frame={frame} lookX={textLeft ? -0.7 : 0.7} lookY={0.6} wave={frame > 40 && frame < 80 ? 1 : 0} />
        </div>
      </div>
      <div style={{ position: "absolute", left: textLeft ? 70 : 680, width: 540, top: 70, height: 540, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 16 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Chip color={person.accent} size={28} style={{ color: "#fff", textShadow: `0 2px 0 ${INK}`, transform: `scale(${pop(2)}) rotate(-3deg)` }}>
            {person.label}
          </Chip>
          <Chip size={24}>
            Step {index + 1} of {STORY.steps.length}
          </Chip>
        </div>
        <h3 style={{ margin: 0, fontSize: 60, lineHeight: 1.06, fontWeight: 900, color: INK }}>
          <Words text={step.title} from={8} step={3} />
        </h3>
        <p style={{ margin: 0, fontSize: 32, lineHeight: 1.3, fontWeight: 700, color: "#374151", opacity: Math.min(1, blurb * 1.5), transform: `translateY(${(1 - blurb) * 30}px)` }}>{step.blurb}</p>
        {step.label && (
          <Chip color={YELLOW} size={26} style={{ transform: `scale(${Math.max(0.6, pop(0))}) rotate(-2deg)`, textTransform: "uppercase", letterSpacing: 1 }}>
            {HONESTY_TEXT[step.label]}
          </Chip>
        )}
      </div>
      <StoryThread index={index} />
    </AbsoluteFill>
  );
}

export function OutcomeScene() {
  const { frame, pop } = useMotion();
  const lines = STORY.outcome.split(/(?<=\.)\s+/);
  return (
    <AbsoluteFill style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 22 }}>
      {lines.map((l, i) => {
        const on = pop(6 + i * 16, { damping: 8, stiffness: 190, mass: 0.6 });
        return (
          <div key={l} style={{ ...chunky(26, 8), padding: "14px 36px", fontSize: 66, fontWeight: 900, color: INK, background: i === 1 ? GREEN_THREAD : "#fff", transform: `scale(${Math.min(1.6, 2.2 - 1.2 * on)}) rotate(${(i - 1) * 2 + Math.sin(frame / 14 + i) * 0.8}deg)`, opacity: Math.min(1, on * 4) }}>
            {l}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
