"use client";

import { Eye, Lightbulb, MessageCircleQuestion, PenLine } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ASK_DEMO, type Answer, type Bar } from "../ask-demo";
import { PEOPLE, THREADS } from "../story";

const THINK_MS = 850;
const stagger = (i: number, extra?: CSSProperties) => ({ "--i": i, ...extra }) as CSSProperties;

function Bars({ bars }: { bars: readonly Bar[] }) {
  return (
    <ul className="lh-bars">
      {bars.map((b, i) => (
        <li key={b.label} style={stagger(i, { "--v": b.value } as CSSProperties)}>
          <span className="lh-bar-label">{b.label}</span>
          <span className="lh-bar-track">
            <span className="lh-bar-fill" />
          </span>
          <span className="lh-bar-text">{b.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Donut({ answer }: { answer: Extract<Answer, { kind: "donut" }> }) {
  return (
    <div className="lh-donut">
      <svg viewBox="0 0 120 120" role="img" aria-label={`${answer.percent}% ${answer.centre}`}>
        <circle cx="60" cy="60" r="46" className="lh-donut-rest" />
        <circle cx="60" cy="60" r="53.5" className="lh-donut-ring" />
        <circle cx="60" cy="60" r="38.5" className="lh-donut-ring" />
        <circle cx="60" cy="60" r="46" pathLength={100} className="lh-donut-arc" style={{ "--len": answer.percent } as CSSProperties} strokeDasharray={`${answer.percent} 100`} />
        <text x="60" y="56" className="lh-donut-num">
          {answer.percent}%
        </text>
        <text x="60" y="72" className="lh-donut-word">
          {answer.centre}
        </text>
      </svg>
      <dl>
        {answer.facts.map((f, i) => (
          <div key={f.label} style={stagger(i)}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const MAP = { w: 600, h: 310, cx: 300, cy: 155, rx: 200, ry: 108 };

/** Branches sit on an ellipse round the centre; each thread is drawn out to its branch, then the branch pops. */
function MindMap({ answer }: { answer: Extract<Answer, { kind: "mindmap" }> }) {
  const n = answer.branches.length;
  return (
    <svg className="lh-map" viewBox={`0 0 ${MAP.w} ${MAP.h}`} role="img" aria-label={`Mind map: ${answer.centre}. ${answer.branches.map((b) => `${b.label}: ${b.leaves.join(", ")}`).join(". ")}.`}>
      {answer.branches.map((b, i) => {
        const angle = -Math.PI / 2 + (i * Math.PI * 2) / n;
        const x = MAP.cx + Math.cos(angle) * MAP.rx;
        const y = MAP.cy + Math.sin(angle) * MAP.ry;
        const above = y < MAP.cy;
        const half = b.label.length * 4.6 + 16;
        return (
          <g key={b.label} style={stagger(i, { "--thread": THREADS[(i + 2) % THREADS.length].color } as CSSProperties)}>
            <path className="lh-map-thread" pathLength={1} d={`M${MAP.cx} ${MAP.cy}Q${(MAP.cx + x) / 2} ${y} ${x} ${y}`} />
            <g className="lh-map-node">
              <rect x={x - half} y={y - 15} width={half * 2} height={30} rx={15} />
              <text x={x} y={y}>
                {b.label}
              </text>
              <text x={x} y={above ? y - 27 : y + 29} className="lh-map-leaf">
                {b.leaves.join(" · ")}
              </text>
            </g>
          </g>
        );
      })}
      <g className="lh-map-centre">
        <rect x={MAP.cx - 78} y={MAP.cy - 21} width={156} height={42} rx={21} />
        <text x={MAP.cx} y={MAP.cy}>
          {answer.centre}
        </text>
      </g>
    </svg>
  );
}

/** Hints before answers: the next hint, then the answer, appear only when asked for. */
function Hints({ answer }: { answer: Extract<Answer, { kind: "hints" }> }) {
  const [lang, setLang] = useState(0);
  const [shown, setShown] = useState(1);
  const l = answer.languages[lang];
  const done = shown > l.hints.length;
  return (
    <div className="lh-hints">
      <div className="lh-hints-lang" role="group" aria-label="Language">
        {answer.languages.map((x, i) => (
          <button key={x.key} type="button" className="lh-filter lm-focus" aria-pressed={lang === i} onClick={() => setLang(i)}>
            {x.label}
          </button>
        ))}
      </div>
      <ol>
        {l.hints.slice(0, shown).map((h, i) => (
          <li key={i} lang={l.key}>
            <Lightbulb aria-hidden className="size-4" />
            <span>
              <strong>Hint {i + 1}.</strong> {h}
            </span>
          </li>
        ))}
        {done && (
          <li data-answer="true" lang={l.key}>
            <strong>{l.answer}</strong>
          </li>
        )}
      </ol>
      {!done && (
        <button type="button" className="lm-btn" data-kind="paper" onClick={() => setShown((s) => s + 1)}>
          {shown < l.hints.length ? "Another hint" : "Show the answer"}
        </button>
      )}
    </div>
  );
}

function Week({ answer }: { answer: Extract<Answer, { kind: "week" }> }) {
  return (
    <div className="lh-week">
      <ol>
        {answer.days.map((d, i) => (
          <li key={d.day} data-tone={d.tone} style={stagger(i)}>
            <span className="lh-week-day">{d.day}</span>
            <span className="lh-week-text">{d.text}</span>
          </li>
        ))}
      </ol>
      <ul>
        {answer.facts.map((f) => (
          <li key={f} className="lm-chip">
            {f}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnswerBody({ answer }: { answer: Answer }) {
  switch (answer.kind) {
    case "bars":
      return <Bars bars={answer.bars} />;
    case "donut":
      return <Donut answer={answer} />;
    case "mindmap":
      return <MindMap answer={answer} />;
    case "hints":
      return <Hints answer={answer} />;
    case "week":
      return <Week answer={answer} />;
  }
}

/**
 * The assistant, as something to try: pick a person, pick one of their questions, and the answer is drawn
 * (a chart, a mind map, hints, a week) instead of written out. Scripted with sample data (ask-demo.ts) and
 * labelled as such: it shows the shape of an answer, not a live model.
 */
export function AskDemo() {
  const wrap = useRef<HTMLDivElement>(null);
  const [role, setRole] = useState(0);
  const [question, setQuestion] = useState(0);
  /** Bumped on every pick, so the same question can be asked again and its drawing replays. */
  const [run, setRun] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [seen, setSeen] = useState(false);

  // The first answer is drawn when the demo scrolls into view, not while it is still off screen.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setSeen(true);
        io.disconnect();
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!thinking) return;
    const id = setTimeout(() => setThinking(false), THINK_MS);
    return () => clearTimeout(id);
  }, [thinking, run]);

  const ask = (r: number, q: number) => {
    setRole(r);
    setQuestion(q);
    setRun((n) => n + 1);
    setThinking(true);
  };

  const person = PEOPLE[ASK_DEMO[role].who];
  const current = ASK_DEMO[role].questions[question];
  const accent = { "--thread": person.accent } as CSSProperties;

  return (
    <div ref={wrap} className="lh-ask">
      <div className="lh-ask-pick">
        <div className="lh-ask-roles" role="group" aria-label="Ask as">
          {ASK_DEMO.map((r, i) => (
            <button key={r.who} type="button" className="lh-filter lm-focus" aria-pressed={role === i} style={{ "--thread": PEOPLE[r.who].accent } as CSSProperties} onClick={() => ask(i, 0)}>
              <span className="lh-tab-bead" aria-hidden="true" />
              {PEOPLE[r.who].label}
            </button>
          ))}
        </div>
        <ul className="lh-ask-qs" aria-label={`Questions a ${person.label.toLowerCase()} asks`}>
          {ASK_DEMO[role].questions.map((q, i) => (
            <li key={q.ask}>
              <button type="button" className="lh-ask-q lm-focus" aria-pressed={question === i} style={accent} onClick={() => ask(role, i)}>
                <MessageCircleQuestion aria-hidden className="size-5" />
                <span>{q.ask}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="lh-caption">
          Illustration with sample data for a made-up school. In the product each answer is read from your school&apos;s records, with the permissions of the person asking.
        </p>
      </div>

      <div className="lh-ask-screen lm-card" style={accent} aria-live="polite" aria-busy={thinking}>
        <p className="lh-ask-said">
          <span className="lm-chip">
            <span className="lh-tab-bead" aria-hidden="true" />
            {person.label}
          </span>
          {current.ask}
        </p>
        {!seen ? null : thinking ? (
          <p className="lh-ask-think">
            <span className="lh-ask-orb" aria-hidden="true" />
            Reading what a {person.label.toLowerCase()} may see
          </p>
        ) : (
          <div key={run} className="lh-ask-answer">
            <p className="lh-ask-title">
              <strong>{current.title}</strong>
              <span className="lm-chip">
                {current.mode === "drafts" ? <PenLine aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
                {current.mode === "drafts" ? "Draft, not saved" : "Reads only"}
              </span>
            </p>
            <AnswerBody answer={current.answer} />
            <p className="lh-ask-source">{current.source}</p>
          </div>
        )}
      </div>
    </div>
  );
}
