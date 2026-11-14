"use client";

import { Ban, Check, PenLine, Sparkles, Trash2 } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { HOME_STATS } from "../stats";
import { AI_NEVER, AI_PROMISE, AI_RULES } from "../story";
import { AskDemo } from "./AskDemo";
import { SkillOrb, type Skill } from "./SkillOrb";

type DraftState = "draft" | "saved" | "discarded";

const DRAFT = "Dear parent, your child was absent on three days this fortnight. Is everything all right? We can share the classwork that was missed.";
const EDITED = "Dear parent, your child was absent on three days this fortnight. Is everything all right? I can send the classwork home, and I am free to talk on Friday after school.";

/** A toy that makes the rule physical: the AI's draft does nothing until a person saves it, and one request is simply refused. */
function DraftToy() {
  const [state, setState] = useState<DraftState>("draft");
  const [edited, setEdited] = useState(false);
  const [refused, setRefused] = useState(0);
  const done = state !== "draft";
  const reset = () => {
    setState("draft");
    setEdited(false);
  };
  return (
    <div className="lh-toy">
      <div className="lh-draft lm-card" data-state={state}>
        <p className="lh-draft-top">
          <span className="lm-chip">
            <Sparkles aria-hidden className="size-3.5" /> AI draft
          </span>
          <span className="lh-draft-kind">Message to a parent · not sent</span>
        </p>
        <p className="lh-draft-text">{edited ? EDITED : DRAFT}</p>
        {done ? (
          <p className="lh-stamp" data-kind={state} role="status">
            {state === "saved" ? "Saved by the class teacher" : "Discarded. Nothing was stored."}
            <button type="button" className="lh-again lm-focus" onClick={reset}>
              Try again
            </button>
          </p>
        ) : (
          <div className="lh-draft-actions">
            <button type="button" className="lm-btn" onClick={() => setState("saved")}>
              <Check aria-hidden className="size-4" /> Save
            </button>
            <button type="button" className="lm-btn" data-kind="paper" onClick={() => setEdited(true)} disabled={edited}>
              <PenLine aria-hidden className="size-4" /> {edited ? "Edited" : "Edit first"}
            </button>
            <button type="button" className="lm-btn" data-kind="paper" onClick={() => setState("discarded")}>
              <Trash2 aria-hidden className="size-4" /> Discard
            </button>
          </div>
        )}
      </div>
      <div className="lh-refuse">
        <p>Now ask it for something it must not do:</p>
        {/* The key replays the shake on every press. */}
        <button key={refused} type="button" className="lm-btn lh-refuse-btn" data-kind="ink" data-refused={refused > 0 || undefined} onClick={() => setRefused((n) => n + 1)}>
          Enter the marks for me
        </button>
        {refused > 0 && (
          <p className="lh-stamp" data-kind="refused" role="status">
            <Ban aria-hidden className="size-4" /> Closed to AI. Marks are entered by a teacher.
          </p>
        )}
      </div>
      <p className="lh-caption">Illustration. In the product the draft opens in the real form, with your school&apos;s data.</p>
    </div>
  );
}

export function Ai({ skills }: { skills: readonly Skill[] }) {
  return (
    <section id="ai" className="lh-section lh-night" aria-labelledby="ai-title">
      <div className="lh-ai-top">
        <div>
          <header className="lh-head" data-reveal="">
            <p className="lm-eyebrow">The AI layer</p>
            <h2 id="ai-title" className="lm-display lh-h2">
              {AI_PROMISE}
            </h2>
            <p className="lm-lead">
              {HOME_STATS.aiSkills} skills across {HOME_STATS.roles} roles, and a study assistant that answers in {HOME_STATS.studyLanguages} languages. Every one of them stops at the same
              line.
            </p>
          </header>
          <ul className="lh-never" aria-label="Never written by AI" data-reveal="" style={{ "--i": 2 } as CSSProperties}>
            {AI_NEVER.map((n) => (
              <li key={n}>
                <Ban aria-hidden className="size-4" /> {n}
              </li>
            ))}
          </ul>
        </div>
        <div data-reveal="right">
          <DraftToy />
        </div>
      </div>

      <div className="lh-ask-block">
        <div className="lh-head" data-reveal="">
          <h3 className="lm-display lh-h3">Ask it. The answer is drawn, not just written.</h3>
          <p className="lm-lead">Pick a person and one of their questions. Charts, a mind map, hints and a week at a glance: the same shapes the assistant draws inside the product.</p>
        </div>
        <AskDemo />
      </div>

      <ol className="lh-rules">
        {AI_RULES.map((r, i) => (
          <li key={r.title} className="lm-card" data-reveal="pop" style={{ "--i": i } as CSSProperties}>
            <span className="lh-rule-num" aria-hidden="true">
              {i + 1}
            </span>
            <h3 className="lh-rule-title">{r.title}</h3>
            <p>{r.body}</p>
          </li>
        ))}
      </ol>

      <div className="lh-ai-orb">
        <div className="lh-head" data-reveal="">
          <h3 className="lm-display lh-h3">Every skill is a switch.</h3>
          <p className="lm-lead">Your school turns each one on or off for each role, with a daily quota. Here they all are.</p>
        </div>
        <SkillOrb skills={skills} />
      </div>
    </section>
  );
}
