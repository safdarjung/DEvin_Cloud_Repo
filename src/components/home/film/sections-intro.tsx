// Film sections 1-3: the loose threads, the seven problems, and the weave.
import { AbsoluteFill, spring, useVideoConfig } from "remotion";
import { Words } from "../../tour/explainer/Beat";
import { Chip, INK, SNAPPY, chunky, useMotion } from "../../tour/explainer/kit";
import { PROBLEMS, THREAD, THREADS } from "../story";
import { Tag, Yarn, wave } from "./film-kit";
import { FILM } from "./film-timeline";

/* ---------- 1. cold open: seven tangled threads, each with a tag ---------- */

const PINS = [
  { x: 170, y: 290 },
  { x: 470, y: 300 },
  { x: 770, y: 285 },
  { x: 1070, y: 295 },
  { x: 320, y: 490 },
  { x: 620, y: 500 },
  { x: 920, y: 485 },
];

/** Thread i always passes through its pin, however it wobbles, so its tag stays hung on it. */
function tangle(i: number, frame: number, calm = 0) {
  const pin = PINS[i];
  const amp = (46 + ((i * 23) % 30)) * (1 - calm);
  const freq = 0.0055 + i * 0.0009;
  const phase = 0.7 * Math.sin(frame / 17 + i * 1.3) + i * 0.8;
  return (x: number) => pin.y + amp * (Math.sin((x - pin.x) * freq + phase) - Math.sin(phase));
}

export function OpenScene() {
  const { frame, pop, ramp } = useMotion();
  return (
    <AbsoluteFill>
      <svg width={1280} height={720} style={{ position: "absolute", inset: 0 }}>
        {PROBLEMS.map((p, i) => {
          const grow = 1 - (1 - ramp(4 + i * 4, 40 + i * 4)) ** 3;
          const fromLeft = i % 2 === 0;
          const x0 = fromLeft ? -40 : 1320;
          return <Yarn key={p.thread} d={wave(tangle(i, frame), x0, x0 + (fromLeft ? 1360 : -1360) * grow)} color={THREAD[p.thread].color} />;
        })}
      </svg>
      {PROBLEMS.map((p, i) => {
        const on = pop(30 + i * 7);
        return (
          <Tag
            key={p.thread}
            color={THREAD[p.thread].color}
            width={186}
            size={21}
            style={{ left: PINS[i].x - 93, top: PINS[i].y, transform: `scale(${on}) rotate(${Math.sin(frame / 13 + i * 1.7) * 7}deg)`, opacity: Math.min(1, on * 3) }}
          >
            {p.artefact}
          </Tag>
        );
      })}
      <h1 style={{ position: "absolute", left: 0, right: 0, top: 46, margin: 0, textAlign: "center", fontSize: 62, fontWeight: 900, color: INK, lineHeight: 1.1 }}>
        <Words text="A school runs on loose threads." from={10} step={3} />
      </h1>
    </AbsoluteFill>
  );
}

/* ---------- 2. the seven problems, one card each, pushed sideways ---------- */

function ProblemCard({ i }: { i: number }) {
  const { frame } = useMotion();
  const p = PROBLEMS[i];
  const t = THREAD[p.thread];
  const local = frame - FILM.problems[i].from + FILM.problems[0].from;
  const mirror = i % 2 === 1;
  const swing = Math.sin(local / 10) * 5;
  const mark = Math.min(1, Math.max(0, (local - 6) / 16));
  const line = (x: number) => 130 + Math.sin(x / 120 + local / 12) * 14;
  return (
    <AbsoluteFill>
      <svg width={1280} height={720} style={{ position: "absolute", inset: 0 }}>
        <Yarn d={wave(line, -40, 1320)} color={t.color} width={18} />
      </svg>
      <Tag color={t.color} width={420} size={48} style={{ left: mirror ? 790 : 70, top: line(mirror ? 1000 : 280), transform: `rotate(${swing + (mirror ? 4 : -4)}deg)` }}>
        {p.artefact}
      </Tag>
      <div style={{ position: "absolute", left: mirror ? 70 : 560, width: 650, top: 180, bottom: 90, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 18 }}>
        <div style={{ display: "flex", gap: 12 }}>
          <Chip color={t.color} size={26} style={{ color: "#fff", textShadow: `0 2px 0 ${INK}` }}>
            {t.label}
          </Chip>
          <Chip size={26}>
            {i + 1} of {PROBLEMS.length}
          </Chip>
        </div>
        <p style={{ margin: 0, fontSize: 60, lineHeight: 1.14, fontWeight: 900, color: INK, position: "relative" }}>
          <span style={{ backgroundImage: `linear-gradient(${t.color}55, ${t.color}55)`, backgroundRepeat: "no-repeat", backgroundSize: `${mark * 100}% 42%`, backgroundPosition: "0 88%", boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone" }}>
            {p.pain}
          </span>
        </p>
      </div>
    </AbsoluteFill>
  );
}

export function ProblemsMontage() {
  const { frame } = useMotion();
  const { fps } = useVideoConfig();
  const base = FILM.problems[0].from;
  const enter = (k: number) => (k <= 0 ? 1 : spring({ frame: frame - (FILM.problems[k].from - base), fps, config: SNAPPY }));
  const idx = Math.min(PROBLEMS.length - 1, Math.floor(frame / FILM.problems[0].duration));
  return (
    <AbsoluteFill>
      {[idx - 1, idx].filter((k) => k >= 0).map((k) => {
        const leave = k + 1 < PROBLEMS.length ? enter(k + 1) : 0;
        return (
          <AbsoluteFill key={k} style={{ transform: `translateX(${(1 - enter(k)) * 1300 - leave * 1300}px) rotate(${(1 - enter(k)) * 4 - leave * 4}deg)` }}>
            <ProblemCard i={k} />
          </AbsoluteFill>
        );
      })}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, display: "flex", justifyContent: "center", gap: 14 }}>
        {PROBLEMS.map((p, k) => (
          <span key={p.thread} style={{ width: k === idx ? 46 : 22, height: 22, borderRadius: 11, border: `3px solid ${INK}`, background: k <= idx ? THREAD[p.thread].color : "#fff" }} />
        ))}
      </div>
    </AbsoluteFill>
  );
}

/* ---------- 3. the weave: threads straighten and interlace into a check cloth ---------- */

const CLOTH = { x: 700, y: 150, size: 476, band: 50 };
const PITCH = CLOTH.size / THREADS.length;
const centre = (k: number) => PITCH * k + PITCH / 2;

export function WeaveScene() {
  const { frame, pop, ramp } = useMotion();
  const calm = 1 - (1 - ramp(0, 34)) ** 2;
  const shrink = 1 - (1 - ramp(8, 38)) ** 3;
  const width = 14 + (CLOTH.band - 14) * ramp(20, 44);
  const x0 = -40 + (CLOTH.x - 4 + 40) * shrink;
  const x1 = 1320 - (1320 - (CLOTH.x + CLOTH.size + 4)) * shrink;
  const drop = THREADS.map((_, c) => pop(40 + c * 6, { damping: 12, stiffness: 150, mass: 0.6 }));
  const settle = pop(90, { damping: 7, stiffness: 180, mass: 0.6 });
  const squash = 1 + Math.sin(Math.min(1, settle) * Math.PI) * 0.05;
  const vx = (c: number) => CLOTH.x + centre(c);
  const vy = (c: number) => (1 - drop[c]) * -700;
  const half = CLOTH.band / 2 + 4;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 70, top: 200, width: 580 }}>
        <h2 style={{ margin: 0, fontSize: 70, lineHeight: 1.08, fontWeight: 900, color: INK }}>
          <Words text="Fabric weaves them into one record." from={36} step={3} />
        </h2>
      </div>
      <div style={{ ...chunky(26, 0), position: "absolute", left: CLOTH.x - 16, top: CLOTH.y - 16, width: CLOTH.size + 32, height: CLOTH.size + 32, background: INK, opacity: ramp(80, 88), transform: `translate(12px, 12px) scale(${squash})` }} />
      <svg width={1280} height={720} style={{ position: "absolute", inset: 0, overflow: "visible", transformOrigin: `${CLOTH.x + CLOTH.size / 2}px ${CLOTH.y + CLOTH.size / 2}px`, transform: `scale(${squash}, ${2 - squash})` }}>
        {THREADS.map((t, c) => (
          <Yarn key={`v${t.key}`} d={`M${vx(c)} ${CLOTH.y - 4 + vy(c)} V${CLOTH.y + CLOTH.size + 4 + vy(c)}`} color={t.color} width={CLOTH.band} cap="butt" />
        ))}
        {THREADS.map((t, r) => {
          const y = CLOTH.y + centre(r);
          const f = (x: number) => y + (1 - calm) * (40 + r * 6) * Math.sin(x / 90 + frame / 9 + r);
          return <Yarn key={`h${t.key}`} d={wave(f, x0, x1)} color={t.color} width={width} cap="butt" />;
        })}
        {THREADS.flatMap((t, c) =>
          THREADS.map((_, r) => {
            if ((r + c) % 2 === 1 || drop[c] < 0.5) return null;
            const y = CLOTH.y + centre(r) + vy(c);
            return (
              <g key={`o${c}-${r}`}>
                <path d={`M${vx(c)} ${y - half} V${y + half}`} stroke={INK} strokeWidth={CLOTH.band + 8} />
                <path d={`M${vx(c)} ${y - half - 1} V${y + half + 1}`} stroke={t.color} strokeWidth={CLOTH.band} />
              </g>
            );
          }),
        )}
      </svg>
    </AbsoluteFill>
  );
}
