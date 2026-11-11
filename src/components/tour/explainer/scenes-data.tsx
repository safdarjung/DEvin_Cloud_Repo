import { BOUNCY, Chip, GREEN, INK, MUTED, Mark, PAPER, Panel, PanelHead, RED, SNAPPY, YELLOW, chunky, useMotion } from "./kit";

export interface SceneProps {
  accent: string;
}

interface Stat {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  fill: number; // 0..1 meter under the number
}

const SCHOOL_STATS: readonly Stat[] = [
  { label: "Attendance", value: 94, suffix: "%", fill: 0.94 },
  { label: "Fees collected", value: 82, prefix: "₹", suffix: "L", fill: 0.7 },
  { label: "Admissions", value: 37, fill: 0.5 },
  { label: "Exam average", value: 78, suffix: "%", fill: 0.78 },
];
const MY_STATS: readonly Stat[] = [
  { label: "Attendance", value: 92, suffix: "%", fill: 0.92 },
  { label: "Assignments", value: 3, fill: 0.3 },
  { label: "Report cards", value: 2, fill: 0.5 },
  { label: "Notifications", value: 4, fill: 0.4 },
];

function StatGrid({ accent, stats }: SceneProps & { stats: readonly Stat[] }) {
  const { pop, count: settle } = useMotion();
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 16, paddingBottom: 12 }}>
      {stats.map((s, i) => {
        const on = pop(10 + i * 9);
        const count = settle(18 + i * 9, 62 + i * 9);
        return (
          <div
            key={s.label}
            style={{
              ...chunky(26, 8),
              background: i === 0 ? accent : "#fff",
              color: i === 0 ? "#fff" : INK,
              padding: "12px 18px",
              transform: `scale(${on}) rotate(${(1 - on) * (i % 2 ? 10 : -10)}deg)`,
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 800, whiteSpace: "nowrap" }}>{s.label}</div>
            <div style={{ fontSize: 58, fontWeight: 900, lineHeight: 1.1 }}>
              {s.prefix}
              {Math.round(s.value * count)}
              {s.suffix}
            </div>
            <div style={{ height: 14, borderRadius: 7, background: i === 0 ? "rgba(255,255,255,.35)" : MUTED, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${s.fill * count * 100}%`, borderRadius: 7, background: i === 0 ? "#fff" : accent }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const Dashboard = ({ accent }: SceneProps) => <StatGrid accent={accent} stats={SCHOOL_STATS} />;
export const Portal = ({ accent }: SceneProps) => <StatGrid accent={accent} stats={MY_STATS} />;

const PAST = [0.42, 0.55, 0.5, 0.68, 0.74];
const NEXT = [0.8, 0.88, 0.95];
const MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"];

export function Forecast({ accent }: SceneProps) {
  const { pop, ramp } = useMotion();
  const line = ramp(60, 100);
  return (
    <Panel>
      <PanelHead title="Fee collection" accent={accent} right={<Chip color={YELLOW} style={{ transform: `scale(${pop(72)})` }}>Forecast</Chip>} />
      <div style={{ position: "relative", height: 226, display: "flex", alignItems: "flex-end", gap: 14 }}>
        {[...PAST, ...NEXT].map((h, i) => {
          const future = i >= PAST.length;
          const grow = pop(future ? 62 + (i - PAST.length) * 9 : 14 + i * 6, future ? BOUNCY : SNAPPY);
          return (
            <div key={MONTHS[i]} style={{ flex: 1, textAlign: "center" }}>
              <div
                style={{
                  height: 184 * h,
                  transform: `scaleY(${grow})`,
                  transformOrigin: "bottom",
                  borderRadius: "12px 12px 4px 4px",
                  border: `3px ${future ? "dashed" : "solid"} ${INK}`,
                  background: future ? PAPER : accent,
                }}
              />
              <div style={{ fontSize: 20, marginTop: 6 }}>{MONTHS[i]}</div>
            </div>
          );
        })}
        <svg viewBox="0 0 500 220" width="100%" height={190} preserveAspectRatio="none" style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <path
            d="M20 130 L150 100 L290 62 L395 30 L478 4"
            fill="none"
            stroke={INK}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray="14 12"
            pathLength={1}
            style={{ clipPath: `inset(-20px ${(1 - line) * 100}% -20px 0)` }}
          />
          <circle cx={478} cy={4} r={11 * pop(100)} fill={YELLOW} stroke={INK} strokeWidth={4} />
        </svg>
      </div>
    </Panel>
  );
}

const STAGES = [
  { label: "Enquiries", n: 120, w: 1 },
  { label: "Applications", n: 64, w: 0.84 },
  { label: "Enrolled", n: 37, w: 0.66 },
];

export function Funnel({ accent }: SceneProps) {
  const { pop, count: settle } = useMotion();
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", alignContent: "center", justifyItems: "center", gap: 16 }}>
      {STAGES.map((s, i) => {
        const on = pop(10 + i * 22);
        const count = settle(14 + i * 22, 50 + i * 22);
        return (
          <div
            key={s.label}
            style={{
              ...chunky(24, 8),
              width: `${s.w * 100}%`,
              padding: "14px 22px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: i === 2 ? accent : "#fff",
              color: i === 2 ? "#fff" : INK,
              transform: `translateY(${(1 - on) * -70}px) scale(${0.6 + 0.4 * on}, ${on})`,
              opacity: Math.min(1, on * 2),
            }}
          >
            <span style={{ fontSize: 28, fontWeight: 900 }}>{s.label}</span>
            <span style={{ fontSize: 50, fontWeight: 900, lineHeight: 1 }}>{Math.round(s.n * count)}</span>
          </div>
        );
      })}
    </div>
  );
}

const ABSENT = new Set([8, 19, 27]);

export function Calendar({ accent }: SceneProps) {
  const { pop, count } = useMotion();
  const pct = Math.round(90 * count(20, 95));
  return (
    <Panel>
      <PanelHead title="This month" accent={accent} />
      <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 6 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 38px)", gap: 8 }}>
          {Array.from({ length: 30 }, (_, i) => {
            const on = pop(16 + i * 2.5, SNAPPY);
            const absent = ABSENT.has(i);
            return (
              <span
                key={i}
                style={{
                  height: 38,
                  borderRadius: 12,
                  border: `3px solid ${INK}`,
                  background: on > 0.5 ? (absent ? RED : GREEN) : MUTED,
                  transform: `scale(${0.5 + 0.5 * on})`,
                }}
              />
            );
          })}
        </div>
        <div style={{ flex: 1, textAlign: "center", transform: `scale(${pop(30)})` }}>
          <div style={{ fontSize: 66, fontWeight: 900, lineHeight: 1, color: accent }}>{pct}%</div>
          <div style={{ fontSize: 24 }}>present</div>
        </div>
      </div>
    </Panel>
  );
}

const PAPERS = [
  { subject: "Maths", marks: 86 },
  { subject: "Science", marks: 91 },
  { subject: "English", marks: 78 },
  { subject: "Hindi", marks: 88 },
];

export function Marks({ accent }: SceneProps) {
  const { pop, ramp } = useMotion();
  const badge = pop(96, { damping: 7, stiffness: 170, mass: 0.7 });
  return (
    <Panel>
      <PanelHead title="Term 1 · of 100" accent={accent} right={<Mark on={pop(84)} size={36} />} />
      <div style={{ display: "grid", gap: 10, width: 262 }}>
        {PAPERS.map((p, i) => {
          const on = pop(12 + i * 16, SNAPPY);
          const typed = Math.round(p.marks * ramp(16 + i * 16, 30 + i * 16));
          return (
            <div key={p.subject} style={{ display: "flex", alignItems: "center", gap: 12, opacity: Math.min(1, on * 2), transform: `translateX(${(1 - on) * -40}px)` }}>
              <span style={{ flex: 1, fontSize: 27 }}>{p.subject}</span>
              <span style={{ width: 84, textAlign: "center", fontSize: 32, fontWeight: 900, borderRadius: 14, border: `3px solid ${INK}`, background: on > 0.9 ? PAPER : YELLOW }}>
                {typed}
              </span>
            </div>
          );
        })}
      </div>
      <div
        style={{
          ...chunky(999, 8),
          position: "absolute",
          right: 20,
          top: 104,
          width: 136,
          height: 136,
          background: accent,
          color: "#fff",
          display: "grid",
          placeItems: "center",
          fontSize: 88,
          fontWeight: 900,
          transform: `scale(${badge}) rotate(${-40 + 28 * badge}deg)`,
        }}
      >
        A
      </div>
    </Panel>
  );
}

/** Fallback for a feature with no dedicated scene: three checklist lines ticking off. */
export function Generic({ accent }: SceneProps) {
  const { pop } = useMotion();
  return (
    <Panel style={{ display: "grid", gap: 18, alignContent: "center" }}>
      {[0.8, 0.6, 0.7].map((w, i) => (
        <div key={w} style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Mark on={pop(30 + i * 18)} size={46} />
          <span style={{ height: 30, width: `${w * 100 * Math.min(1, pop(14 + i * 10, SNAPPY))}%`, borderRadius: 15, background: accent, border: `3px solid ${INK}` }} />
        </div>
      ))}
    </Panel>
  );
}
