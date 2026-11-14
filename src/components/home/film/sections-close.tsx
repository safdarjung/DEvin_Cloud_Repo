// Film sections 5-8: the people, the AI rule, the numbers and the end card.
import { AbsoluteFill } from "remotion";
import { Words } from "../../tour/explainer/Beat";
import { Chip, INK, RED, YELLOW, chunky, useMotion } from "../../tour/explainer/kit";
import { MASCOT_H, MASCOT_W, Mascot } from "../../tour/explainer/Mascot";
import { HOME_STATS } from "../stats";
import { AI_NEVER, AI_PROMISE, PEOPLE, TAGLINE, THREAD, THREADS, type PersonKey } from "../story";
import { WovenMark, Yarn, wave } from "./film-kit";

/* ---------- 5. people ---------- */

const CAST: readonly PersonKey[] = ["principal", "admin", "teacher", "student", "parent"];

export function PeopleScene() {
  const { frame, pop } = useMotion();
  return (
    <AbsoluteFill>
      <h2 style={{ position: "absolute", left: 0, right: 0, top: 60, margin: 0, textAlign: "center", fontSize: 64, fontWeight: 900, color: INK }}>
        <Words text="Each person sees their own school." from={6} step={3} />
      </h2>
      {CAST.map((key, i) => {
        const p = PEOPLE[key];
        const cx = 170 + i * 235;
        const hop = pop(14 + i * 6, { damping: 9, stiffness: 140, mass: 0.7 });
        const bounce = Math.abs(Math.sin((frame - i * 7) / 9)) * 10 * Math.min(1, hop);
        const waving = frame > 60 && Math.floor((frame - 60) / 18) % CAST.length === i;
        return (
          <div key={key}>
            <div style={{ position: "absolute", left: cx - MASCOT_W / 2, top: 540 - MASCOT_H - bounce + (1 - hop) * 420, width: MASCOT_W, height: MASCOT_H, transform: "scale(1.2)", transformOrigin: "50% 100%" }}>
              <Mascot role={p.tour} accent={p.accent} frame={frame + i * 11} wave={waving ? 1 : 0} lookX={(2 - i) * 0.3} lookY={-0.3} />
            </div>
            <div style={{ position: "absolute", left: cx - 120, width: 240, top: 562, textAlign: "center", transform: `scale(${pop(30 + i * 6)})` }}>
              <Chip color={p.accent} size={26} style={{ color: "#fff", textShadow: `0 2px 0 ${INK}` }}>
                {p.label}
              </Chip>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/* ---------- 6. AI: the promise, then the four things it never writes ---------- */

export function AiScene() {
  const { frame, pop, ramp } = useMotion();
  const [first, second] = AI_PROMISE.split(/(?<=\.)\s+/);
  const lift = 1 - (1 - ramp(84, 108)) ** 3;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 180 - lift * 150, textAlign: "center", transform: `scale(${1 - lift * 0.48})`, transformOrigin: "50% 0" }}>
        <div style={{ fontSize: 120, fontWeight: 900, color: INK, lineHeight: 1.05 }}>
          <Words text={first} from={6} step={4} />
        </div>
        <div style={{ fontSize: 120, fontWeight: 900, color: INK, lineHeight: 1.05, marginTop: 12 }}>
          <span style={{ backgroundImage: `linear-gradient(${YELLOW}, ${YELLOW})`, backgroundRepeat: "no-repeat", backgroundSize: `${ramp(40, 60) * 100}% 40%`, backgroundPosition: "0 85%" }}>
            <Words text={second} from={26} step={4} />
          </span>
        </div>
      </div>
      {AI_NEVER.map((word, i) => {
        const on = pop(108 + i * 6, { damping: 12, stiffness: 150, mass: 0.7 });
        const stamp = pop(128 + i * 16, { damping: 9, stiffness: 260, mass: 0.6 });
        const left = i % 2 === 0 ? 100 : 660;
        const top = i < 2 ? 236 : 444;
        return (
          <div key={word} style={{ ...chunky(26, 8), position: "absolute", left, top, width: 520, height: 176, padding: "22px 28px", transform: `translateY(${(1 - on) * 500}px) rotate(${i % 2 ? 1.5 : -1.5}deg)` }}>
            <div style={{ fontSize: word.length > 12 ? 46 : 54, fontWeight: 900, color: INK, lineHeight: 1, whiteSpace: "nowrap" }}>{word}</div>
            <div
              style={{
                position: "absolute",
                left: 24,
                bottom: 22,
                padding: "6px 16px",
                border: `5px solid ${RED}`,
                borderRadius: 12,
                color: RED,
                fontSize: 27,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: 1,
                background: "#fff",
                opacity: stamp > 0.05 ? 1 : 0,
                transform: `rotate(${-7 + Math.sin(frame / 20 + i) * 0.6}deg) scale(${Math.min(2.4, 2.4 - 1.4 * stamp)})`,
              }}
            >
              Never written by AI
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/* ---------- 7. numbers ---------- */

const COUNTERS = [
  { value: HOME_STATS.modules, label: "modules", color: THREAD.fees.color },
  { value: HOME_STATS.roles, label: "roles", color: THREAD.exams.color },
  { value: HOME_STATS.aiSkills, label: "AI skills", color: THREAD.learning.color },
  { value: HOME_STATS.studyLanguages, label: "study languages", color: THREAD.attendance.color },
] as const;

function Toggle({ on, size = 1 }: { on: number; size?: number }) {
  return (
    <span style={{ display: "inline-block", position: "relative", width: 76 * size, height: 42 * size, borderRadius: 999, border: `4px solid ${INK}`, background: on > 0.5 ? THREAD.attendance.color : "#E5E7EB", flex: "none" }}>
      <span style={{ position: "absolute", top: 3 * size, left: (3 + on * 34) * size, width: 28 * size, height: 28 * size, borderRadius: "50%", border: `3px solid ${INK}`, background: "#fff" }} />
    </span>
  );
}

export function NumbersScene() {
  const { frame, pop, count, ramp } = useMotion();
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, top: 70, display: "flex", justifyContent: "center", alignItems: "center", gap: 26 }}>
        <Toggle on={ramp(96, 106)} size={1.3} />
        <h2 style={{ margin: 0, fontSize: 64, fontWeight: 900, color: INK }}>
          <Words text="Switch on only what you need." from={86} step={3} />
        </h2>
      </div>
      {COUNTERS.map((c, i) => {
        const on = pop(6 + i * 7);
        const n = Math.round(c.value * count(12 + i * 8, 62 + i * 8));
        return (
          <div key={c.label} style={{ ...chunky(28, 10), position: "absolute", left: 64 + i * 292, top: 210, width: 268, height: 330, overflow: "hidden", transform: `translateY(${(1 - on) * 420}px) rotate(${(i % 2 ? 2 : -2) * (1 - on) + Math.sin(frame / 18 + i) * 0.8}deg)` }}>
            <div style={{ height: 28, background: c.color, borderBottom: `4px solid ${INK}` }} />
            <div style={{ textAlign: "center", fontSize: 128, fontWeight: 900, color: INK, lineHeight: 1, marginTop: 44, fontVariantNumeric: "tabular-nums" }}>{n}</div>
            <div style={{ textAlign: "center", fontSize: 30, fontWeight: 800, color: "#374151", marginTop: 14 }}>{c.label}</div>
            <div style={{ display: "flex", justifyContent: "center", marginTop: 22 }}>
              <Toggle on={ramp(70 + i * 8, 78 + i * 8)} />
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/* ---------- 8. end card ---------- */

// The burst flies past the frame edge and fades, so no bit is left lying across the wordmark or the tagline.
const BITS = Array.from({ length: 16 }, (_, i) => ({ angle: (i / 16) * Math.PI * 2 + 0.2, reach: 640 + ((i * 61) % 200), color: THREADS[i % THREADS.length].color }));

export function EndScene() {
  const { frame, pop, ramp } = useMotion();
  const mark = pop(6, { damping: 8, stiffness: 150, mass: 0.7 });
  const cta = pop(44, { damping: 8, stiffness: 170, mass: 0.7 });
  const burst = ramp(8, 50);
  const tap = 1 - 0.06 * Math.max(0, Math.sin((frame - 70) / 7)) ** 6;
  const stripe = 1 - (1 - ramp(24, 56)) ** 3;
  return (
    <AbsoluteFill>
      {BITS.map((b, i) => {
        const reach = b.reach * (1 - (1 - burst) ** 3);
        return (
          <svg key={i} width={90} height={40} style={{ position: "absolute", left: 640 + Math.cos(b.angle) * reach - 45, top: 300 + Math.sin(b.angle) * reach * 0.62 - 20, opacity: burst > 0 ? 1 - burst ** 2 : 0, transform: `rotate(${b.angle * 57 + frame * 2}deg)` }}>
            <Yarn d={wave((x) => 20 + Math.sin(x / 9 + i) * 8, 10, 80, 5)} color={b.color} width={8} />
          </svg>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, top: 140, display: "flex", justifyContent: "center", alignItems: "center", gap: 34, transform: `translateY(${Math.sin(frame / 22) * 5}px)` }}>
        <span style={{ transform: `rotate(${Math.sin(frame / 30) * 4}deg)` }}>
          <WovenMark size={150} on={mark} />
        </span>
        <span style={{ fontSize: 160, fontWeight: 900, color: INK, letterSpacing: -4, lineHeight: 1 }}>
          {[..."Fabric"].map((ch, i) => {
            const on = pop(12 + i * 3);
            return (
              <span key={i} style={{ display: "inline-block", transform: `translateY(${(1 - on) * 90}px) scale(${on}, ${2 - on})` }}>
                {ch}
              </span>
            );
          })}
        </span>
      </div>
      <div style={{ position: "absolute", left: 340, width: 600 * stripe, top: 336, height: 14, borderRadius: 7, border: `3px solid ${INK}`, background: `linear-gradient(90deg, ${THREADS.map((t) => t.color).join(", ")})` }} />
      <p style={{ position: "absolute", left: 0, right: 0, top: 378, margin: 0, textAlign: "center", fontSize: 46, fontWeight: 800, color: INK }}>
        <Words text={TAGLINE} from={26} step={2} />
      </p>
      <div style={{ position: "absolute", left: 0, right: 0, top: 486, display: "grid", placeItems: "center" }}>
        <div style={{ ...chunky(999, 12 * tap), padding: "20px 56px", background: YELLOW, color: INK, fontSize: 54, fontWeight: 900, transform: `scale(${cta * tap}) translateY(${(1 - tap) * 60}px)` }}>Try the demo. No sign-up.</div>
      </div>
    </AbsoluteFill>
  );
}
