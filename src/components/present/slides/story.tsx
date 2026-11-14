import { Clapperboard } from "lucide-react";
import type { CSSProperties } from "react";
import { HONESTY_TEXT, PEOPLE, STORIES, THREAD } from "@/components/home/story";
import { FeatureIcon } from "@/components/tour/explainer/icon";
import type { SlideProps } from "../slide-meta";
import "./story.css";

const USE_CASES = ["absent", "fees", "results"] as const;

/** One use case: the steps reveal one at a time down a yarn line; the newest step is open. */
function StorySlide({ storyKey, step, onFilm }: SlideProps & { storyKey: (typeof USE_CASES)[number] }) {
  const story = STORIES.find((s) => s.key === storyKey);
  if (!story) return null;
  const n = story.steps.length;
  const style = { "--th": THREAD[story.thread].color, "--p": Math.max(0, step - 1) / (n - 1) } as CSSProperties;
  return (
    <div className="st-wrap" style={style}>
      <div className="st-side">
        <p className="dk-eyebrow">
          <span className="lm-chip dk-chip st-case">
            Use case {USE_CASES.indexOf(storyKey) + 1} of {USE_CASES.length}
          </span>
          {THREAD[story.thread].label}
        </p>
        <h2 className="lm-display st-h2">{story.title}</h2>
        <p className="dk-body st-q">{story.question}</p>
        <button type="button" className="lm-btn dk-btn" onClick={() => onFilm(story.key)}>
          <Clapperboard aria-hidden className="dk-ico" /> Play the film
        </button>
        <p className="lm-display st-outcome dk-frag" data-on={step >= n} aria-hidden={step < n || undefined}>
          {story.outcome}
        </p>
      </div>
      <ol className="st-steps">
        {story.steps.map((s, i) => {
          const person = PEOPLE[s.who];
          const state = i + 1 < step ? "done" : i + 1 === step ? "current" : "hidden";
          return (
            <li key={s.title} className="st-row" data-state={state} aria-hidden={state === "hidden" || undefined}>
              <span className="st-knot" aria-hidden>
                {i + 1}
              </span>
              <div className="st-body">
                <div className="st-line">
                  <h3 className="st-title">{s.title}</h3>
                  <span className="lm-chip dk-chip">
                    <i className="dk-dot" style={{ background: person.accent }} aria-hidden />
                    {person.label}
                  </span>
                  {s.label && <span className="lm-honest dk-honest">{HONESTY_TEXT[s.label]}</span>}
                </div>
                <p className="st-blurb">
                  <FeatureIcon name={s.icon} aria-hidden className="st-icon" />
                  {s.blurb}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export const AbsentSlide = (p: SlideProps) => <StorySlide storyKey="absent" {...p} />;
export const FeesSlide = (p: SlideProps) => <StorySlide storyKey="fees" {...p} />;
export const ResultsSlide = (p: SlideProps) => <StorySlide storyKey="results" {...p} />;
