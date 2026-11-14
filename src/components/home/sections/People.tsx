"use client";

import { ArrowRight, Box, Play, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRef, useState, type CSSProperties } from "react";
import { TOUR_ROLES } from "@/components/tour/roles";
import { homeIcon } from "../icons";
import { HONESTY_TEXT } from "../story";
import { tabKeyDown } from "../tabs";

const ExplainerPlayer = dynamic(() => import("@/components/tour/explainer/ExplainerPlayer"), {
  ssr: false,
  loading: () => <p className="lh-wait">Loading the explainer…</p>,
});

/** The five people of the school tour, as tabs: what each one gets, their explainer film, their demo, their 3D room. */
export function People() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const role = TOUR_ROLES[active];

  return (
    <section id="people" className="lh-section" aria-labelledby="people-title">
      <header className="lh-head" data-reveal="">
        <p className="lm-eyebrow">Who uses it</p>
        <h2 id="people-title" className="lm-display lh-h2">
          Five people. One school.
        </h2>
        <p className="lm-lead">Each person signs in to their own view of the same record. Pick one, then try their account on a sample school.</p>
      </header>

      <div className="lh-doors" data-reveal="" role="tablist" aria-label="People" onKeyDown={(e) => tabKeyDown(e, TOUR_ROLES.length, active, setActive)}>
        {TOUR_ROLES.map((r, i) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            id={`people-tab-${r.key}`}
            aria-selected={i === active}
            tabIndex={i === active ? 0 : -1}
            aria-controls="people-panel"
            className="lh-door lm-focus"
            style={{ "--thread": r.accent } as CSSProperties}
            onClick={() => setActive(i)}
          >
            <span className="lh-door-room">{r.room}</span>
            <span className="lh-door-label">{r.label}</span>
          </button>
        ))}
      </div>

      <div id="people-panel" role="tabpanel" aria-labelledby={`people-tab-${role.key}`} className="lh-person lm-card" data-reveal="" style={{ "--thread": role.accent } as CSSProperties}>
        <div className="lh-person-head">
          <h3 className="lm-display lh-h3">{role.tagline}</h3>
          <div className="lh-person-actions">
            <form method="post" action="/api/public/demo-login">
              <input type="hidden" name="email" value={role.demoEmail} />
              <button type="submit" className="lm-btn">
                Try the {role.label} demo <ArrowRight aria-hidden className="size-4" />
              </button>
            </form>
            <button
              type="button"
              className="lm-btn"
              data-kind="paper"
              onClick={() => {
                setPlaying(true);
                dialog.current?.showModal();
              }}
            >
              <Play aria-hidden className="size-4" fill="currentColor" /> Play their film
            </button>
            <Link href={`/tour#tour-${role.key}`} className="lm-btn" data-kind="paper">
              <Box aria-hidden className="size-4" /> Visit the {role.room.toLowerCase()} in 3D
            </Link>
          </div>
        </div>
        <ul className="lh-features">
          {role.features.map((f) => {
            const Icon = homeIcon(f.icon);
            return (
            <li key={f.title}>
              <span className="lh-feature-icon" aria-hidden="true">
                <Icon size={22} strokeWidth={2.4} />
              </span>
              <span>
                <span className="lh-feature-title">
                  {f.title} {f.label && <span className="lm-honest">{HONESTY_TEXT[f.label]}</span>}
                </span>
                <span className="lh-feature-blurb">{f.blurb}</span>
              </span>
            </li>
            );
          })}
        </ul>
      </div>
      <p className="lh-foot">
        Nine roles in all: owner, principal, administrator, admissions officer, accountant, exam controller, teacher, student and guardian. A person sees only what their role,
        and their own rows, allow.
      </p>

      <dialog ref={dialog} className="lh-dialog" aria-label={`${role.label} feature film`} data-lenis-prevent onClose={() => setPlaying(false)}>
        <div className="lh-dialog-frame">{playing && <ExplainerPlayer role={role.key} />}</div>
        <form method="dialog">
          <button type="submit" className="lh-dialog-close lm-focus" aria-label="Close the film">
            <X aria-hidden className="size-5" />
          </button>
        </form>
      </dialog>
    </section>
  );
}
