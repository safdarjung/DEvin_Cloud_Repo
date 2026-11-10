import { interpolate } from "remotion";
import { Bar, Chip, GREEN, INK, MUTED, Mark, PAPER, Panel, PanelHead, RED, SNAPPY, YELLOW, chunky, inr, useMotion } from "./kit";
import type { SceneProps } from "./scenes-data";

const COLUMNS = ["Enquiry", "Applied", "Enrolled"];

/** One application card hops across the pipeline columns and lands as "Enrolled". */
export function Kanban({ accent }: SceneProps) {
  const { pop } = useMotion();
  const hop1 = pop(40);
  const hop2 = pop(78);
  const x = (hop1 + hop2) * 151;
  const lift = Math.sin(Math.min(1, hop1) * Math.PI) * 26 * (hop2 > 0.01 ? 0 : 1) + Math.sin(Math.min(1, hop2) * Math.PI) * 26;
  const done = pop(100);
  return (
    <Panel style={{ padding: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, height: "100%" }}>
        {COLUMNS.map((c, i) => (
          <div key={c} style={{ borderRadius: 20, background: PAPER, border: `3px solid ${INK}`, padding: 10, transform: `scale(${pop(6 + i * 6, SNAPPY)})` }}>
            <div style={{ fontSize: 23, fontWeight: 900, textAlign: "center", marginBottom: 92 }}>{c}</div>
            {i < 2 && (
              <div style={{ ...chunky(16, 5), padding: 12, display: "grid", gap: 8, opacity: 0.55 }}>
                <Bar w="80%" />
                <Bar w="50%" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div
        style={{
          ...chunky(16, 6),
          position: "absolute",
          left: 26,
          top: 60,
          width: 124,
          padding: 12,
          display: "grid",
          gap: 8,
          background: done > 0.5 ? GREEN : accent,
          transform: `translate(${x}px, ${-lift}px) rotate(${Math.sin((hop1 + hop2) * Math.PI) * 6}deg) scale(${pop(18)})`,
        }}
      >
        <span style={{ fontSize: 21, fontWeight: 900, color: "#fff" }}>Class 6</span>
        <Bar w="70%" color="rgba(255,255,255,.7)" />
      </div>
      <Chip color={GREEN} size={24} style={{ position: "absolute", right: 18, bottom: 26, transform: `scale(${done})` }}>
        Enrolled ✓
      </Chip>
    </Panel>
  );
}

const LINES = [
  { label: "Tuition fee", amount: 12000 },
  { label: "Transport", amount: 2500 },
];

/** A receipt prints out of a slot, the total counts up, then PAID stamps on. */
export function Receipt({ accent }: SceneProps) {
  const { frame, pop, ramp } = useMotion();
  const print = ramp(8, 56);
  const jitter = print < 1 ? Math.sin(frame * 1.6) * 2 : 0;
  const total = 14500 * ramp(54, 86);
  const stamp = pop(92, { damping: 8, stiffness: 190, mass: 0.6 });
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", left: 44, right: 44, top: 18, bottom: 0, overflow: "hidden" }}>
        <div
          style={{
            ...chunky(18, 0),
            borderTop: "none",
            borderRadius: "0 0 18px 18px",
            padding: "18px 22px",
            color: INK,
            fontSize: 26,
            fontWeight: 800,
            transform: `translate(${jitter}px, ${(print - 1) * 100}%)`,
          }}
        >
          <div style={{ fontSize: 30, fontWeight: 900, marginBottom: 30 }}>Fee receipt</div>
          {LINES.map((l) => (
            <div key={l.label} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
              <span>{l.label}</span>
              <span>{inr(l.amount)}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, paddingTop: 6 }}>
            {["Cash", "UPI", "Bank"].map((m, i) => (
              <Chip key={m} size={20} color={m === "UPI" && frame > 70 ? YELLOW : "#fff"} style={{ transform: `scale(${pop(60 + i * 5)})` }}>
                {m}
              </Chip>
            ))}
          </div>
          <div style={{ borderTop: `4px dashed ${INK}`, margin: "12px 0 0", display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: 10 }}>
            <span>Total</span>
            <span style={{ fontSize: 50, fontWeight: 900, color: accent }}>{inr(total)}</span>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left: 18, right: 18, top: 0, height: 30, borderRadius: 15, background: INK }} />
      <div
        style={{
          position: "absolute",
          right: 26,
          top: 30,
          padding: "4px 22px",
          border: `6px solid ${GREEN}`,
          borderRadius: 16,
          color: GREEN,
          background: "#fff",
          fontSize: 38,
          fontWeight: 900,
          letterSpacing: 3,
          opacity: Math.min(1, stamp * 2),
          transform: `scale(${3 - 2 * stamp}) rotate(-8deg)`,
        }}
      >
        PAID
      </div>
    </div>
  );
}

/** A browser window fills with page blocks, Publish gets pressed, the page goes live. */
export function Website({ accent }: SceneProps) {
  const { pop, ramp } = useMotion();
  const press = 1 - 0.14 * Math.sin(ramp(76, 88) * Math.PI);
  const live = pop(88);
  return (
    <Panel style={{ padding: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: `4px solid ${INK}`, background: PAPER }}>
        {[RED, YELLOW, GREEN].map((c) => (
          <span key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c, border: `2px solid ${INK}` }} />
        ))}
        <span style={{ flex: 1, marginLeft: 8, padding: "3px 14px", borderRadius: 12, border: `3px solid ${INK}`, background: "#fff", fontSize: 20 }}>
          your-school / notices
        </span>
      </div>
      <div style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ height: 70, borderRadius: 16, border: `3px solid ${INK}`, background: accent, transform: `scaleX(${pop(12, SNAPPY)})`, transformOrigin: "left", display: "grid", placeItems: "center", color: "#fff", fontSize: 30, fontWeight: 900 }}>
          Annual Day · 14 Dec
        </div>
        {["Notice: PTM on Saturday", "Event: Science fair"].map((t, i) => {
          const on = pop(30 + i * 14);
          return (
            <div key={t} style={{ padding: "8px 14px", borderRadius: 14, border: `3px solid ${INK}`, fontSize: 23, opacity: Math.min(1, on * 2), transform: `translateY(${(1 - on) * 30}px)` }}>
              {t}
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
          <Chip size={24} color={live > 0.5 ? GREEN : MUTED}>{live > 0.5 ? "● Live" : "Draft"}</Chip>
          <span style={{ ...chunky(18, 6 * press), padding: "6px 26px", background: YELLOW, fontSize: 26, fontWeight: 900, transform: `scale(${pop(56) * press})` }}>
            Publish
          </span>
        </div>
      </div>
    </Panel>
  );
}

const TASKS = [
  { title: "Essay draft", from: "Graded 8/10", color: GREEN, at: 0 },
  { title: "Maths worksheet", from: "Submitted", color: YELLOW, at: 64 },
  { title: "Science project", from: "Due Friday", color: "#fff", at: 0 },
];

/** Assignment rows; the middle one flips from due to submitted. */
export function Assignments({ accent }: SceneProps) {
  const { frame, pop } = useMotion();
  return (
    <Panel>
      <PanelHead title="Assignments" accent={accent} />
      <div style={{ display: "grid", gap: 14 }}>
        {TASKS.map((t, i) => {
          const on = pop(12 + i * 12);
          const flipped = frame >= t.at;
          const flip = t.at ? pop(t.at, { damping: 8, stiffness: 200, mass: 0.6 }) : 1;
          return (
            <div key={t.title} style={{ ...chunky(20, 6), padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, transform: `translateX(${(1 - on) * 90}px)`, opacity: Math.min(1, on * 2) }}>
              <span style={{ flex: 1, fontSize: 24, whiteSpace: "nowrap" }}>{t.title}</span>
              <Chip size={20} color={flipped ? t.color : "#fff"} style={{ transform: `scale(${t.at && flipped ? flip : 1})` }}>
                {flipped ? t.from : "Due today"}
              </Chip>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu"];
const TIMES = ["3:00", "3:30", "4:00"];
const TAKEN = new Set([1, 4, 6, 11]);
const PICK = 5;

/** A slot grid lights up free slots, one is picked and marked booked. */
export function Meetings({ accent }: SceneProps) {
  const { pop } = useMotion();
  const picked = pop(74, { damping: 8, stiffness: 190, mass: 0.6 });
  return (
    <Panel>
      <PanelHead title="Book a slot" accent={accent} right={<Chip size={19} color={GREEN} style={{ transform: `scale(${pop(86)})` }}>Tue 3:30 booked</Chip>} />
      <div style={{ display: "grid", gridTemplateColumns: "58px repeat(4, 1fr)", gap: 8, alignItems: "center" }}>
        <span />
        {DAYS.map((d) => (
          <span key={d} style={{ textAlign: "center", fontSize: 21 }}>{d}</span>
        ))}
        {TIMES.flatMap((t, r) => [
          <span key={t} style={{ fontSize: 22 }}>{t}</span>,
          ...DAYS.map((d, c) => {
            const i = r * 4 + c;
            const on = pop(14 + i * 4, SNAPPY);
            const isPick = i === PICK && picked > 0.3;
            return (
              <span
                key={t + d}
                style={{
                  height: 50,
                  borderRadius: 16,
                  border: `3px solid ${INK}`,
                  background: isPick ? accent : TAKEN.has(i) ? MUTED : on > 0.5 ? "#D9F7E3" : MUTED,
                  transform: `scale(${(0.6 + 0.4 * on) * (i === PICK ? 1 + 0.12 * Math.sin(Math.min(1, picked) * Math.PI) : 1)})`,
                  display: "grid",
                  placeItems: "center",
                  color: "#fff",
                  fontSize: 30,
                  fontWeight: 900,
                }}
              >
                {isPick ? "✓" : ""}
              </span>
            );
          }),
        ])}
      </div>
      
    </Panel>
  );
}

const ROLLS = [1, 2, 3, 4];
const FIXED = 2;

/** "Mark all present" ticks a section in one go, then one row is corrected with a reason. */
export function Register({ accent }: SceneProps) {
  const { frame, pop, ramp } = useMotion();
  const press = 1 - 0.14 * Math.sin(ramp(26, 38) * Math.PI);
  const fix = pop(84, { damping: 8, stiffness: 200, mass: 0.6 });
  return (
    <Panel>
      <PanelHead
        title="6-B · Today"
        accent={accent}
        right={<span style={{ ...chunky(14, 5 * press), padding: "3px 14px", background: YELLOW, fontSize: 20, fontWeight: 900, transform: `scale(${pop(10) * press})` }}>Mark all present</span>}
      />
      <div style={{ display: "grid", gap: 8 }}>
        {ROLLS.map((roll, i) => {
          const corrected = i === FIXED && frame >= 84;
          return (
            <div key={roll} style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 12px", borderRadius: 16, border: `3px solid ${INK}`, background: corrected ? "#FFE4E1" : PAPER }}>
              <span style={{ fontSize: 22, width: 76 }}>Roll {roll}</span>
              <span style={{ flex: 1 }}>
                {corrected ? <Chip size={17} color={YELLOW} style={{ transform: `scale(${interpolate(fix, [0, 1], [0.4, 1])})` }}>Corrected · sick leave</Chip> : <Bar w={`${60 + ((i * 17) % 30)}%`} />}
              </span>
              <Mark on={corrected ? fix : pop(36 + i * 5)} ok={!corrected} size={38} />
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
