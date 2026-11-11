import type { ReactNode } from "react";
import { Bar, Chip, GREEN, INK, Mark, PAPER, Panel, PanelHead, Row, SNAPPY, Tap, YELLOW, chunky, useMotion } from "./kit";
import type { SceneProps } from "./scenes-data";

/** Reveals text left to right, like it is being typed or written. */
function Typed({ text, from, to }: { text: string; from: number; to: number }) {
  const { ramp } = useMotion();
  return <>{text.slice(0, Math.round(text.length * ramp(from, to)))}</>;
}

const BRIEF = ["4 approvals waiting", "Attendance 94% today", "12 fee invoices overdue", "2 insights to review"];

/** The sun comes up behind a short checklist for the day. */
export function Briefing({ accent }: SceneProps) {
  const { frame, pop } = useMotion();
  const rise = pop(4, { damping: 12, stiffness: 60, mass: 1 });
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div style={{ position: "absolute", right: 24, top: 130 - rise * 130, width: 150, height: 150, transform: `rotate(${frame * 0.8}deg)` }}>
        {Array.from({ length: 8 }, (_, i) => (
          <span key={i} style={{ position: "absolute", left: 66, top: -22, width: 18, height: 194, borderRadius: 9, background: YELLOW, border: `3px solid ${INK}`, transform: `rotate(${i * 22.5}deg)` }} />
        ))}
        <span style={{ position: "absolute", inset: 14, borderRadius: "50%", background: YELLOW, border: `4px solid ${INK}` }} />
      </div>
      <Panel style={{ top: 66 }}>
        <PanelHead title="Today's briefing" accent={accent} />
        <div style={{ display: "grid", gap: 7 }}>
          {BRIEF.map((t, i) => (
            <Row key={t} on={pop(26 + i * 14)} style={{ padding: "4px 12px" }}>
              <span style={{ width: 16, height: 16, borderRadius: 8, background: accent, border: `3px solid ${INK}` }} />
              <span style={{ fontSize: 24 }}>{t}</span>
            </Row>
          ))}
        </div>
      </Panel>
    </div>
  );
}

const REPORTS = [
  { name: "Attendance report", when: "Daily · 4:00 pm" },
  { name: "Fee defaulters", when: "Mondays · 8:00 am" },
];

/** A clock spins round to the scheduled time and each report lands as ready. */
export function Reports({ accent }: SceneProps) {
  const { frame, pop } = useMotion();
  return (
    <Panel>
      <PanelHead title="Scheduled reports" accent={accent} />
      <div style={{ display: "grid", gap: 16 }}>
        {REPORTS.map((r, i) => {
          const ready = pop(58 + i * 26);
          const spin = Math.min(frame, 58 + i * 26) * 14;
          return (
            <div key={r.name} style={{ ...chunky(22, 7), padding: "14px 14px", display: "flex", alignItems: "center", gap: 12, transform: `scale(${pop(10 + i * 10)})` }}>
              <span style={{ position: "relative", width: 56, height: 56, flex: "none", borderRadius: "50%", border: `4px solid ${INK}`, background: PAPER }}>
                <span style={{ position: "absolute", left: 22, top: 4, width: 5, height: 22, borderRadius: 3, background: INK, transformOrigin: "50% 100%", transform: `rotate(${spin}deg)` }} />
                <span style={{ position: "absolute", left: 22, top: 11, width: 5, height: 15, borderRadius: 3, background: accent, transformOrigin: "50% 100%", transform: `rotate(${spin / 12 + 90}deg)` }} />
              </span>
              <span style={{ flex: 1, whiteSpace: "nowrap" }}>
                <span style={{ display: "block", fontSize: 24, fontWeight: 900 }}>{r.name}</span>
                <span style={{ fontSize: 20 }}>{r.when}</span>
              </span>
              <Chip size={19} color={GREEN} style={{ transform: `scale(${ready})` }}>Ready</Chip>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

const FLAGS = ["8-B attendance falling", "Maths marks dipped", "Fees overdue 30+ days"];

/** Flagged rows pulse a warning, then get handed to a person for review. */
export function Insights({ accent }: SceneProps) {
  const { frame, pop } = useMotion();
  return (
    <Panel>
      <PanelHead title="Flagged" accent={accent} right={<Chip size={18} color={accent} style={{ color: "#fff", transform: `scale(${pop(84)})` }}>Needs human review</Chip>} />
      <div style={{ display: "grid", gap: 11 }}>
        {FLAGS.map((t, i) => (
          <Row key={t} on={pop(12 + i * 16)}>
            <span style={{ width: 38, height: 38, flex: "none", borderRadius: 12, background: YELLOW, border: `3px solid ${INK}`, display: "grid", placeItems: "center", fontSize: 26, fontWeight: 900, transform: `scale(${1 + 0.12 * Math.sin((frame - i * 6) / 4)})` }}>
              !
            </span>
            <span style={{ fontSize: 23 }}>{t}</span>
          </Row>
        ))}
      </div>
    </Panel>
  );
}

const CHANNELS = [
  { name: "Email", status: "Sent", live: true },
  { name: "SMS", status: "Simulated", live: false },
  { name: "WhatsApp", status: "Simulated", live: false },
];

/** One message fans out to three channels; only email is really sent. */
export function Messages({ accent }: SceneProps) {
  const { pop } = useMotion();
  return (
    <div style={{ position: "absolute", inset: 0, color: INK, fontWeight: 800 }}>
      <div style={{ ...chunky(26, 8), borderBottomLeftRadius: 6, background: accent, color: "#fff", padding: "14px 20px", fontSize: 26, width: "fit-content", transform: `scale(${pop(8)})`, transformOrigin: "left bottom" }}>
        <Typed text="PTM this Saturday, 10 am." from={12} to={40} />
      </div>
      <div style={{ display: "grid", gap: 12, marginTop: 20, marginLeft: 44 }}>
        {CHANNELS.map((c, i) => (
          <Row key={c.name} on={pop(46 + i * 14)} style={{ background: "#fff", borderWidth: 4, padding: "10px 16px" }}>
            <span style={{ flex: 1, fontSize: 26, fontWeight: 900 }}>{c.name}</span>
            <Chip size={21} color={c.live ? GREEN : YELLOW}>{c.status}</Chip>
            {c.live && <Mark on={pop(64)} size={34} />}
          </Row>
        ))}
      </div>
    </div>
  );
}

const EVENTS = [
  { who: "Office staff", what: "edited a fee invoice", at: "10:42" },
  { who: "Class teacher", what: "corrected attendance", at: "11:05" },
  { who: "Principal", what: "published results", at: "11:20" },
];

/** Log entries drop in newest-first; older ones get pushed down. */
export function Audit({ accent }: SceneProps) {
  const { pop } = useMotion();
  const shown = EVENTS.map((_, i) => pop(14 + i * 28));
  return (
    <Panel>
      <PanelHead title="Audit log" accent={accent} right={<Mark on={pop(100)} size={36} />} />
      <div style={{ position: "relative", height: 250 }}>
        {EVENTS.map((e, i) => {
          const pushed = shown.slice(i + 1).reduce((sum, s) => sum + Math.min(1, s), 0);
          return (
            <div
              key={e.at}
              style={{ position: "absolute", left: 0, right: 0, top: 0, display: "flex", gap: 12, alignItems: "center", padding: "8px 14px", borderRadius: 18, border: `3px solid ${INK}`, background: PAPER, opacity: Math.min(1, shown[i] * 2), transform: `translateY(${pushed * 84 - (1 - shown[i]) * 60}px)` }}
            >
              <span style={{ fontSize: 21, fontWeight: 900, padding: "2px 10px", borderRadius: 10, background: accent, color: "#fff" }}>{e.at}</span>
              <span style={{ fontSize: 22, lineHeight: 1.2 }}>
                <b style={{ fontWeight: 900 }}>{e.who}</b>
                <br />
                {e.what}
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Phone({ accent, children }: SceneProps & { children: ReactNode }) {
  return (
    <div style={{ position: "absolute", inset: "0 44px 0 44px", border: `5px solid ${INK}`, borderBottom: "none", borderRadius: "40px 40px 0 0", background: accent, padding: "44px 18px 0", overflow: "hidden", color: INK, fontWeight: 800 }}>
      <span style={{ position: "absolute", left: "50%", top: 14, width: 90, height: 14, marginLeft: -45, borderRadius: 7, background: INK }} />
      <div style={{ display: "grid", gap: 12 }}>{children}</div>
    </div>
  );
}

function Toast({ at, title, body, tag }: { at: number; title: string; body: string; tag?: string }) {
  const { pop } = useMotion();
  const on = pop(at);
  return (
    <div style={{ ...chunky(20, 6), padding: "10px 16px", transform: `translateY(${(1 - on) * -120}px) scale(${0.8 + 0.2 * on})`, opacity: Math.min(1, on * 2) }}>
      <div style={{ fontSize: 24, fontWeight: 900 }}>{title}</div>
      <div style={{ fontSize: 21 }}>{body}</div>
      {tag && <Chip size={18} color={YELLOW} style={{ marginTop: 6 }}>{tag}</Chip>}
    </div>
  );
}

function Bell() {
  const { frame, pop } = useMotion();
  const ring = Math.sin(frame / 1.6) * 16 * Math.max(0, 1 - Math.abs(frame - 34) / 22);
  return (
    <div style={{ ...chunky(999, 7), width: 104, height: 104, margin: "14px auto 0", background: YELLOW, display: "grid", placeItems: "center", transform: `scale(${pop(8)}) rotate(${ring}deg)` }}>
      <svg width={58} height={58} viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
    </div>
  );
}

export const Notifications = ({ accent }: SceneProps) => (
  <Phone accent={accent}>
    <Toast at={62} title="Result published" body="Term 1 report card" />
    <Toast at={38} title="Homework posted" body="Maths · Exercise 4.2" />
    <Toast at={14} title="Notice" body="School closed on Friday" />
  </Phone>
);

export const Alert = ({ accent }: SceneProps) => (
  <Phone accent={accent}>
    <Toast at={22} title="Absent today" body="Marked absent · 6-B" tag="SMS · simulated" />
    <Bell />
  </Phone>
);

const NOTES = ["Maths — Ex 4.2, Q1 to 10", "Science — read chapter 3", "English — bring poem book"];

/** Homework lines get written into a spiral notebook. */
export function Diary({ accent }: SceneProps) {
  return (
    <Panel style={{ paddingLeft: 60, background: "#FFFDF5" }}>
      <div style={{ position: "absolute", left: 14, top: 18, bottom: 18, display: "grid", alignContent: "space-between" }}>
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} style={{ width: 30, height: 14, borderRadius: 7, border: `3px solid ${INK}`, background: accent }} />
        ))}
      </div>
      <div style={{ fontSize: 28, fontWeight: 900, marginBottom: 6 }}>Class diary · 6-B</div>
      {NOTES.map((t, i) => (
        <div key={t} style={{ fontSize: 25, height: 60, lineHeight: "60px", borderBottom: `3px solid #CFE3FF`, whiteSpace: "nowrap" }}>
          <Typed text={t} from={14 + i * 30} to={40 + i * 30} />
        </div>
      ))}
    </Panel>
  );
}

const OPTIONS = ["1/2", "1", "4/8"];

/** A unit goes in, the AI thinks, a draft quiz card flips out for review. */
export function Quiz({ accent }: SceneProps) {
  const { frame, pop } = useMotion();
  const flip = pop(52, SNAPPY);
  const thinking = frame > 22 && frame < 54;
  return (
    <div style={{ position: "absolute", inset: 0, color: INK, fontWeight: 800 }}>
      <div style={{ ...chunky(22, 6), borderBottomRightRadius: 6, marginLeft: "auto", width: "fit-content", padding: "10px 18px", fontSize: 25, background: accent, color: "#fff", transform: `scale(${pop(6)})`, transformOrigin: "right bottom" }}>
        Unit: Fractions
      </div>
      {thinking && (
        <div style={{ ...chunky(22, 6), width: 110, marginTop: 14, padding: "16px 0", display: "flex", gap: 9, justifyContent: "center" }}>
          {[0, 1, 2].map((d) => (
            <span key={d} style={{ width: 16, height: 16, borderRadius: 8, background: INK, transform: `translateY(${Math.sin((frame - d * 4) / 2.5) * 6}px)` }} />
          ))}
        </div>
      )}
      <div style={{ perspective: 900, position: "absolute", left: 0, right: 0, top: 78, bottom: 10 }}>
        <div style={{ ...chunky(26, 8), height: "100%", padding: 20, opacity: flip > 0.05 ? 1 : 0, transform: `rotateY(${(1 - flip) * 100}deg)`, transformOrigin: "left center" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontSize: 22 }}>Question 1</span>
            <Chip size={19} color={YELLOW} style={{ transform: `scale(${pop(96)})` }}>Draft · you review</Chip>
          </div>
          <div style={{ fontSize: 32, fontWeight: 900, marginBottom: 14 }}>What is 3/4 + 1/4 ?</div>
          <div style={{ display: "flex", gap: 12 }}>
            {OPTIONS.map((o, i) => (
              <span key={o} style={{ flex: 1, textAlign: "center", padding: "10px 0", fontSize: 30, fontWeight: 900, borderRadius: 18, border: `3px solid ${INK}`, background: i === 1 && frame > 88 ? GREEN : PAPER, transform: `scale(${pop(66 + i * 7)})` }}>
                {o}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Tap x={240} y={222} at={88} accent={accent} />
    </div>
  );
}

const FIELDS = ["Adm no. 1042", "Class 6-B", "2 guardians"];

/** Student record cards deal in; the top one fills in its details. */
export function Roster({ accent }: SceneProps) {
  const { pop } = useMotion();
  return (
    <div style={{ position: "absolute", inset: 0, color: INK, fontWeight: 800 }}>
      {[2, 1].map((k) => (
        <div key={k} style={{ ...chunky(28, 8), position: "absolute", inset: "24px 16px 30px", transform: `rotate(${k * 5 * pop(4 + k * 6)}deg) translateY(${(1 - pop(4 + k * 6)) * 200}px)`, background: PAPER }} />
      ))}
      <div style={{ ...chunky(28, 8), position: "absolute", inset: "24px 16px 30px", padding: 20, display: "flex", gap: 18, transform: `translateY(${(1 - pop(18)) * 260}px) rotate(${(1 - pop(18)) * -12}deg)` }}>
        <div style={{ width: 124, height: 150, flex: "none", borderRadius: 22, border: `4px solid ${INK}`, background: accent, position: "relative", overflow: "hidden" }}>
          <span style={{ position: "absolute", left: 34, top: 24, width: 56, height: 56, borderRadius: "50%", background: "#fff", border: `4px solid ${INK}` }} />
          <span style={{ position: "absolute", left: 12, top: 92, width: 100, height: 90, borderRadius: 45, background: "#fff", border: `4px solid ${INK}` }} />
        </div>
        <div style={{ flex: 1, display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ fontSize: 30, fontWeight: 900 }}>Student record</div>
          <Bar w="70%" h={18} />
          {FIELDS.map((f, i) => (
            <Chip key={f} size={22} color={i === 0 ? YELLOW : "#fff"} style={{ width: "fit-content", transform: `scale(${pop(40 + i * 14)})`, transformOrigin: "left center" }}>
              {f}
            </Chip>
          ))}
        </div>
        <Chip size={22} color={GREEN} style={{ position: "absolute", right: 18, bottom: 16, transform: `scale(${pop(92)})` }}>Enrolled ✓</Chip>
      </div>
    </div>
  );
}
