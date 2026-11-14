import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Beat, Words } from "../../tour/explainer/Beat";
import { FilmAudio } from "../../tour/explainer/FilmAudio";
import { BOUNCY, Chip, FONT, INK, chunky, useMotion } from "../../tour/explainer/kit";
import { MASCOT_H, MASCOT_W, Mascot } from "../../tour/explainer/Mascot";
import { BEAT_POSES, END_POSE, LAYOUTS, TITLE_POSE, Backdrop, ProgressPill, Wipes, type Pose } from "../../tour/explainer/Stage";
import { WIPE_FRAMES, explainerTimeline } from "../../tour/explainer/timeline";
import { HONESTY_TEXT, PEOPLE, THREAD, type Story } from "../story";

export interface StoryExplainerProps extends Record<string, unknown> {
  story: Story;
}

export const storyTimeline = (story: Story) => explainerTimeline(story.steps.length);

function TitleCard({ story }: { story: Story }) {
  const { pop } = useMotion();
  const thread = THREAD[story.thread];
  const chip = pop(10);
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 520, right: 70, top: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start" }}>
        <Chip color={thread.color} size={28} style={{ color: "#fff", transform: `scale(${chip}) rotate(${(1 - chip) * -20 - 3}deg)`, textTransform: "uppercase", letterSpacing: 1 }}>
          {thread.label}
        </Chip>
        <h1 style={{ fontSize: story.title.length > 10 ? 84 : 128, margin: "18px 0 14px", color: INK, fontWeight: 900, lineHeight: 1, whiteSpace: "nowrap" }}>
          {[...story.title].map((ch, i) => {
            const on = pop(14 + i * 2);
            return (
              <span key={i} style={{ display: "inline-block", whiteSpace: "pre", transform: `translateY(${(1 - on) * 80}px) scale(${on}, ${2 - on})` }}>
                {ch}
              </span>
            );
          })}
        </h1>
        <p style={{ fontSize: 36, lineHeight: 1.3, fontWeight: 700, color: "#374151", margin: 0 }}>
          <Words text={story.question} from={32} step={2} />
        </p>
      </div>
    </AbsoluteFill>
  );
}

function EndCard({ story }: { story: Story }) {
  const { frame, pop } = useMotion();
  const thread = THREAD[story.thread];
  const cta = pop(40, { damping: 8, stiffness: 170, mass: 0.7 });
  const tap = 1 - 0.07 * Math.max(0, Math.sin((frame - 64) / 6)) ** 6;
  return (
    <AbsoluteFill>
      <h2 style={{ position: "absolute", left: 140, right: 140, top: 340, textAlign: "center", fontSize: 58, lineHeight: 1.12, color: INK, fontWeight: 900, margin: 0 }}>
        <Words text={story.outcome} from={10} step={2} />
      </h2>
      <div style={{ position: "absolute", left: 0, right: 0, top: 560, display: "grid", placeItems: "center" }}>
        <div style={{ ...chunky(999, 10 * tap), padding: "16px 44px", background: thread.color, color: "#fff", fontSize: 40, fontWeight: 900, transform: `scale(${cta * tap})` }}>
          See it in the demo
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** One mascot for the whole film; it hops over each wipe and takes the look of whoever the next beat is about. */
function StoryMascot({ story }: { story: Story }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = storyTimeline(story);
  const people = story.steps.map((s) => PEOPLE[s.who]);
  const targets: Pose[] = [...story.steps.map((_, i) => BEAT_POSES[i % LAYOUTS]), END_POSE];
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
  const n = story.steps.length;
  const isBeat = section >= 1 && section <= n;
  const person = people[Math.min(Math.max(section, 1), n) - 1];
  const wave = isBeat ? 0 : Math.min(1, Math.max(0, (frame - (section === 0 ? 20 : t.end.from + 12)) / 10));
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
        role={person.tour}
        accent={person.accent}
        frame={frame}
        wave={wave}
        lookX={pose.lookX}
        lookY={pose.lookY}
        talking={isBeat && (section - 1) % LAYOUTS === 2 && air < 0.05 && frame - t.beats[section - 1].from < 100}
      />
    </div>
  );
}

export function StoryExplainer({ story }: StoryExplainerProps) {
  const t = storyTimeline(story);
  const thread = THREAD[story.thread];
  return (
    <AbsoluteFill className="tour-explainer" style={{ fontFamily: FONT }}>
      <style>{".tour-explainer *{box-sizing:border-box}"}</style>
      <Backdrop accent={thread.color} />
      <Sequence from={t.title.from} durationInFrames={t.title.duration}>
        <TitleCard story={story} />
      </Sequence>
      {story.steps.map((step, i) => {
        const person = PEOPLE[step.who];
        return (
          <Sequence key={`${step.title}-${i}`} from={t.beats[i].from} durationInFrames={t.beats[i].duration}>
            <Beat
              feature={{ title: step.title, blurb: step.blurb, icon: step.icon, label: step.label }}
              index={i}
              accent={person.accent}
              scene={step.scene}
              who={person.label}
              labelText={step.label ? HONESTY_TEXT[step.label] : undefined}
            />
          </Sequence>
        );
      })}
      <Sequence from={t.end.from} durationInFrames={t.end.duration}>
        <EndCard story={story} />
      </Sequence>
      <Wipes accent={thread.color} cuts={t.cuts} />
      <ProgressPill accent={thread.color} count={story.steps.length} />
      <StoryMascot story={story} />
      <FilmAudio filmId={`story-${story.key}`} />
    </AbsoluteFill>
  );
}
