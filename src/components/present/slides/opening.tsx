import { Play } from "lucide-react";
import type { CSSProperties } from "react";
import { HONESTY_TEXT, PROBLEMS, TAGLINE, THREAD, THREADS, type ThreadKey } from "@/components/home/story";
import type { SlideProps } from "../slide-meta";
import { Strand, Weave } from "../Weave";
import "./opening.css";

export const threadVar = (key: ThreadKey) => ({ "--th": THREAD[key].color }) as CSSProperties;

export function YarnDots() {
  return (
    <span className="dk-yarn" aria-hidden>
      {THREADS.map((t) => (
        <i key={t.key} style={{ background: t.color }} />
      ))}
    </span>
  );
}

export function TitleSlide({ onFilm }: SlideProps) {
  return (
    <div className="t-wrap">
      <div className="t-copy">
        <p className="dk-eyebrow">
          <YarnDots /> A school operating system
        </p>
        <h1 className="lm-display t-name">Fabric</h1>
        <p className="lm-display t-tag">{TAGLINE}</p>
        <p className="dk-body t-line">One system for budget-conscious Indian private schools.</p>
        <button type="button" className="lm-btn dk-btn" onClick={() => onFilm("film")}>
          <Play aria-hidden className="dk-ico" /> Watch the 90-second film
        </button>
      </div>
      <div className="t-art">
        <Weave className="t-weave" />
      </div>
    </div>
  );
}

export function ThreadsSlide() {
  return (
    <>
      <p className="dk-eyebrow">The school today</p>
      <h2 className="lm-display dk-h2">Seven loose threads</h2>
      <ul className="th-list">
        {PROBLEMS.map((p) => (
          <li key={p.thread} style={threadVar(p.thread)}>
            <Strand color={THREAD[p.thread].color} width={150} className="th-strand" />
            <span className="th-tag">{p.artefact}</span>
            <span className="th-pain">
              {p.pain}
              {p.label && <span className="lm-honest dk-honest">{HONESTY_TEXT[p.label]}</span>}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

const COST_THREADS: readonly ThreadKey[] = ["attendance", "fees", "exams", "admissions"];

export function CostSlide() {
  return (
    <div className="c-wrap">
      <div className="c-head">
        <p className="dk-eyebrow">What that costs</p>
        <h2 className="lm-display c-h2">Nothing breaks. Things slip through the gaps.</h2>
      </div>
      <ul className="c-grid">
        {COST_THREADS.map((key, i) => {
          const p = PROBLEMS.find((x) => x.thread === key);
          if (!p) return null;
          return (
            <li key={key} className="lm-card c-card" style={{ ...threadVar(key), rotate: `${[-1.2, 0.8, 0.6, -0.9][i]}deg` }}>
              <span className="c-tag">{p.artefact}</span>
              <p>{p.detail}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The idea weave is drawn 470px wide; its viewBox is 7 cells of 66 plus the 14 gap. */
const WEAVE_PX = 470;
const WEAVE_VB = 7 * 66 + 14;

export function IdeaSlide() {
  return (
    <div className="i-wrap">
      <div className="i-copy">
        <p className="dk-eyebrow">The idea</p>
        <h2 className="lm-display i-h2">
          One record.
          <br />
          Every thread connected.
        </h2>
        <p className="dk-body i-lead">Mark it once. The office, the parent and the principal read the same record, each in their own view.</p>
        <ul className="i-chips" aria-label="The threads">
          {THREADS.map((t) => (
            <li key={t.key} className="lm-chip dk-chip">
              <i className="dk-dot" style={{ background: t.color }} aria-hidden />
              {t.label}
            </li>
          ))}
        </ul>
      </div>
      <div className="i-art">
        {/* Loose ends run in from the left and disappear under the cloth, one per weft row. */}
        {THREADS.map((t, i) => (
          <Strand key={t.key} color={t.color} width={190} height={30} className="i-tail" style={{ top: ((14 + 26 + 66 * i) * WEAVE_PX) / WEAVE_VB - 15 }} />
        ))}
        <Weave className="i-weave" band={52} gap={14} />
      </div>
    </div>
  );
}
