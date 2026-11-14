import { ArrowRight, Box, CalendarCheck, Presentation } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { FilmButton } from "../FilmButton";
import { HONESTY_TEXT, PLAIN_FACTS, START_STEPS, TAGLINE } from "../story";
import { WeaveArt } from "../WeaveArt";

/** How a school starts, what is not finished (said plainly), and every way to keep exploring. */
export function Closing() {
  return (
    <>
      <section id="start" className="lh-section" aria-labelledby="start-title">
        <header className="lh-head" data-reveal="">
          <p className="lm-eyebrow">Getting started</p>
          <h2 id="start-title" className="lm-display lh-h2">
            Three steps from spreadsheet to school.
          </h2>
        </header>
        <ol className="lh-start">
          {START_STEPS.map((s, i) => (
            <li key={s.title} className="lm-card" data-reveal="pop" style={{ "--i": i } as CSSProperties}>
              <span className="lh-start-num lm-display" aria-hidden="true">
                {i + 1}
              </span>
              <h3 className="lh-rule-title">{s.title}</h3>
              <p>{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="lh-foot">
          Pricing is quoted per school, for the modules you switch on. <Link href="/pricing" className="lh-link">How a quote is scoped</Link>.
        </p>

        <div className="lh-plain lm-card" role="group" aria-labelledby="plain-title" data-reveal="">
          <h3 id="plain-title" className="lm-display lh-h3">
            Stated plainly
          </h3>
          <p>What is not finished, in the same words the product uses on screen.</p>
          <ul>
            {PLAIN_FACTS.map((f) => (
              <li key={f.text}>
                <span className="lm-honest">{f.label === "planned" ? "Planned" : HONESTY_TEXT[f.label]}</span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="explore" className="lh-finale" aria-labelledby="finale-title">
        <WeaveArt className="lh-finale-art" lanes={9} reveal />
        <div className="lh-finale-copy" data-reveal="">
          <p className="lm-eyebrow">Your turn</p>
          <h2 id="finale-title" className="lm-display lh-h2">
            {TAGLINE}
          </h2>
          <p className="lm-lead">See it with your own school in mind, or walk in right now as any of the five people.</p>
          <div className="lf-actions">
            <Link href="/contact" className="lm-btn" data-kind="ink">
              <CalendarCheck aria-hidden className="size-4" /> Book a demo
            </Link>
            <Link href="/demo" className="lm-btn" data-kind="paper">
              Try a demo <ArrowRight aria-hidden className="size-4" />
            </Link>
          </div>
          <ul className="lh-ways">
            <li>
              <FilmButton kind="paper" label="Watch the film" />
              <span>Fabric in 90 seconds, narrated, with on-screen text.</span>
            </li>
            <li>
              <Link href="/tour" className="lm-btn" data-kind="paper">
                <Box aria-hidden className="size-4" /> Walk the 3D school
              </Link>
              <span>Scroll through five rooms and meet the people in them.</span>
            </li>
            <li>
              <Link href="/product/deck" className="lm-btn" data-kind="paper">
                <Presentation aria-hidden className="size-4" /> Open the deck
              </Link>
              <span>The same story as slides, for a staff room or a board meeting.</span>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
