"use client";

import { Play } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type CSSProperties } from "react";
import { HONESTY_TEXT, PEOPLE, STORIES, THREAD } from "../story";
import { tabKeyDown } from "../tabs";

const StoryPlayer = dynamic(() => import("../film/StoryPlayer"), {
  ssr: false,
  loading: () => <p className="lh-wait">Loading the film…</p>,
});

/**
 * Use cases: five everyday moments, each a thread followed through the school step by step. The steps are
 * always on the page as text; the film beside them is optional and loads on the first play. Steps and film
 * stay in step both ways: a click seeks the film, the film highlights the step it is showing.
 */
export function Stories() {
  const [active, setActive] = useState(0);
  const [step, setStep] = useState(0);
  const [seek, setSeek] = useState<{ step: number; nonce: number } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const story = STORIES[active];
  const thread = THREAD[story.thread];

  const pick = (i: number) => {
    setActive(i);
    setStep(0);
    setSeek(null);
  };
  const go = (i: number) => {
    setStep(i);
    setLoaded(true);
    setSeek((s) => ({ step: i, nonce: (s?.nonce ?? 0) + 1 }));
  };

  return (
    <section id="stories" className="lh-section" aria-labelledby="stories-title">
      <header className="lh-head" data-reveal="">
        <p className="lm-eyebrow">Use cases</p>
        <h2 id="stories-title" className="lm-display lh-h2">
          Follow one thread through the school.
        </h2>
        <p className="lm-lead">Five everyday moments. Each step shows who acts and what Fabric does for them. Tap a step, or play the film.</p>
      </header>

      <div className="lh-tabs" data-reveal="" role="tablist" aria-label="Use cases" onKeyDown={(e) => tabKeyDown(e, STORIES.length, active, pick)}>
        {STORIES.map((s, i) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            id={`story-tab-${s.key}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            aria-controls="story-panel"
            className="lh-tab lm-focus"
            style={{ "--thread": THREAD[s.thread].color } as CSSProperties}
            onClick={() => pick(i)}
          >
            <span className="lh-tab-bead" aria-hidden="true" />
            {s.title}
          </button>
        ))}
      </div>

      <div id="story-panel" role="tabpanel" aria-labelledby={`story-tab-${story.key}`} className="lh-story" data-reveal="" style={{ "--thread": thread.color } as CSSProperties}>
        <div className="lh-story-text">
          <p className="lh-question">{story.question}</p>
          <ol className="lh-steps">
            {story.steps.map((s, i) => {
              const who = PEOPLE[s.who];
              return (
                <li key={s.title}>
                  <button type="button" className="lh-step lm-focus" aria-current={i === step ? "step" : undefined} onClick={() => go(i)}>
                    <span className="lh-step-num" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="lh-step-body">
                      <span className="lh-step-top">
                        <span className="lm-chip" style={{ "--thread": who.accent } as CSSProperties}>
                          <span className="lh-tab-bead" aria-hidden="true" />
                          {who.label}
                        </span>
                        {s.label && <span className="lm-honest">{HONESTY_TEXT[s.label]}</span>}
                      </span>
                      <span className="lh-step-title">{s.title}</span>
                      <span className="lh-step-blurb">{s.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="lh-outcome">
            <span aria-hidden="true">→</span> {story.outcome}
          </p>
        </div>

        <div className="lh-story-film">
          <div className="lh-screen lm-card">
            {loaded ? (
              <StoryPlayer story={story} seek={seek} onStep={setStep} autoPlay />
            ) : (
              <button type="button" className="lh-poster lm-focus" onClick={() => go(0)}>
                <span className="lh-poster-thread" aria-hidden="true" />
                <span className="lm-chip">{thread.label}</span>
                <span className="lm-display lh-poster-title">{story.title}</span>
                <span className="lh-poster-play">
                  <Play aria-hidden className="size-5" fill="currentColor" /> Play the 30-second film
                </span>
              </button>
            )}
          </div>
          <p className="lh-caption">Animated illustration with sample data, not a recording of the live app.</p>
        </div>
      </div>
    </section>
  );
}
