import { Lock } from "lucide-react";
import type { CSSProperties } from "react";
import { HOME_STATS } from "@/components/home/stats";
import { AI_NEVER, AI_PROMISE, AI_RULES, HONESTY_TEXT } from "@/components/home/story";
import { TOUR_ROLES } from "@/components/tour/roles";
import { MODULES, type ModuleCategory } from "@/lib/modules/catalog";
import type { SlideProps } from "../slide-meta";
import { YarnDots } from "./opening";
import "./product.css";

export function PeopleSlide() {
  return (
    <ul className="pp-grid">
      {TOUR_ROLES.map((r, i) => (
        <li key={r.key} className="lm-card pp-card" style={{ "--role": r.accent, rotate: `${[-1, 0.8, -0.5, 1, -0.8][i]}deg` } as CSSProperties}>
          <h3 className="lm-display pp-name">{r.label}</h3>
          <p>{r.tagline}</p>
        </li>
      ))}
      <li className="pp-head">
        <p className="dk-eyebrow">
          <YarnDots /> Who uses it
        </p>
        <h2 className="lm-display pp-h2">Five people. One system.</h2>
        <p className="dk-body">Each signs in to their own view of the same school.</p>
      </li>
    </ul>
  );
}

const [promiseA, promiseB] = AI_PROMISE.split(". ");

export function AiSlide() {
  return (
    <div className="ai-wrap">
      <div className="ai-copy">
        <p className="dk-eyebrow">AI in Fabric</p>
        <h2 className="lm-display ai-h2">
          {promiseA}.
          <br />
          <mark>{promiseB}</mark>
        </h2>
        <div className="ai-stats">
          <p className="lm-card ai-stat">
            <b className="lm-display">{HOME_STATS.aiSkills}</b> AI skills, each switched on or off per role
          </p>
          <p className="lm-card ai-stat">
            <b className="lm-display">{HOME_STATS.studyLanguages}</b> languages a student can study in
          </p>
        </div>
      </div>
      <div className="lm-card ai-never">
        <p className="ai-never-h">Closed to AI, in code</p>
        <ul>
          {AI_NEVER.map((x) => (
            <li key={x} className="lm-display">
              <Lock aria-hidden className="ai-lock" />
              {x}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AiRulesSlide({ step }: SlideProps) {
  return (
    <div className="r-wrap">
      <p className="dk-eyebrow">AI in Fabric</p>
      <h2 className="lm-display dk-h2">Four rules the AI follows</h2>
      <ol className="r-list">
        {AI_RULES.map((r, i) => (
          <li key={r.title} className="r-row" data-open={i + 1 === step} data-seen={i + 1 <= step}>
            <span className="lm-display r-num" aria-hidden>
              {i + 1}
            </span>
            <div>
              <h3 className="r-title">{r.title}</h3>
              <p className="r-body">{r.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Decorative yarn colour per catalogue area. */
const CATEGORY_COLOR: Record<ModuleCategory, string> = {
  Core: "var(--th-office)",
  Academics: "var(--th-learning)",
  Exams: "var(--th-exams)",
  "Admissions & Website": "var(--th-admissions)",
  "People & HR": "var(--th-attendance)",
  "Finance+": "var(--th-fees)",
  Operations: "var(--th-office)",
  Communication: "var(--th-parents)",
  Reports: "var(--th-exams)",
  AI: "var(--th-learning)",
  Intelligence: "var(--th-parents)",
};

const GROUPS = Object.values(MODULES).reduce<Map<ModuleCategory, string[]>>((acc, m) => {
  acc.set(m.category, [...(acc.get(m.category) ?? []), m.label]);
  return acc;
}, new Map());

export function ModulesSlide() {
  return (
    <div className="m-wrap">
      <div className="m-head">
        <h2 className="lm-display dk-h2">Everything in the box</h2>
        <p className="dk-body">
          <b>{HOME_STATS.modules} modules</b> in <b>{HOME_STATS.categories} areas</b>. The core is always on; every other module is a switch.
        </p>
      </div>
      <div className="m-cols">
        {[...GROUPS].map(([cat, labels]) => (
          <section key={cat} className="m-group" style={{ "--th": CATEGORY_COLOR[cat] } as CSSProperties} aria-label={cat}>
            <h3>
              {cat} <span>{labels.length}</span>
            </h3>
            <ul>
              {labels.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {/* Rule 7: these channels are listed as modules above, so the slide says what state they are in. */}
      <p className="m-note">
        <span className="lm-honest">{HONESTY_TEXT["test mode"]}</span> Online Payments
        <br />
        <span className="lm-honest">{HONESTY_TEXT.simulated}</span> Email, SMS, WhatsApp
      </p>
    </div>
  );
}
