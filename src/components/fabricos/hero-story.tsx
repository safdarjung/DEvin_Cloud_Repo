// FabricOS hero + scroll-linked ecosystem story. Server component: all copy is
// in the SSR HTML (the H1 is the LCP element and never waits for JS or 3D).
// Client islands (hero-shell.tsx) add the stage tracking, the lazy WebGL scene
// over a static SVG, and the accessible node explorer.
import Link from "next/link";
import type { CSSProperties } from "react";
import { CTA, DEFINITION, DESCRIPTION, SECTION, STORY, TAGLINE } from "./content";
import { HeroExplorer, HeroProvider, HeroStage } from "./hero-shell";
import "./hero.css";

/** Stagger index for the CSS entrance (`.fos-in`). */
const at = (i: number) => ({ "--i": i }) as CSSProperties;

export function HeroStory() {
  return (
    <HeroProvider>
      <HeroStage />
      <div className="fos-hs__content">
        <section className="fos-hero" data-hs-step="hero" aria-labelledby="fos-hero-title">
          <div className="fos-hero__text">
            <p className="fos-hero__brand fos-in" style={at(0)}>
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M8 1.5 13.6 4.75v6.5L8 14.5 2.4 11.25v-6.5Z" fill="none" />
                <circle cx="8" cy="8" r="2" />
              </svg>
              FabricOS
            </p>
            <h1 id="fos-hero-title" className="fos-hero__title">
              {TAGLINE.split(/(?<=\.)\s+/).map((line, i) => (
                <span key={line}>
                  {i > 0 ? " " : null}
                  <span className="fos-hero__line">{line}</span>
                </span>
              ))}
            </h1>
            <p className="fos-hero__lead fos-in" style={at(2)}>
              {DESCRIPTION}
            </p>
            <div className="fos-hero__ctas fos-in" style={at(3)}>
              <Link href={CTA.primary.href} className="fos-btn fos-btn--primary">
                {CTA.primary.label}
              </Link>
              <Link href={CTA.secondary.href} className="fos-btn fos-btn--ghost">
                {CTA.secondary.label}
              </Link>
            </div>
            <Link href={CTA.tour.href} className="fos-hero__tour fos-in" style={at(4)}>
              {CTA.tour.label}
              <svg viewBox="0 0 16 16" aria-hidden>
                <path d="M3 8h9.5M9 4.5 12.5 8 9 11.5" />
              </svg>
            </Link>
            <p className="fos-hero__def fos-in" style={at(5)}>
              {DEFINITION}
            </p>
          </div>
          <div className="fos-hero__explore fos-in" style={at(6)}>
            <HeroExplorer />
          </div>
        </section>

        <section id={SECTION.platform} className="fos-story" aria-labelledby="fos-story-title">
          <h2 id="fos-story-title" className="fos-story__title">
            One operating system for the whole institution
          </h2>
          <ol className="fos-story__steps">
            {STORY.map((s, i) => (
              <li key={s.id} className="fos-step" data-hs-step={i}>
                <div className="fos-step__card">
                  <h3 className="fos-step__title">{s.title}</h3>
                  <p className="fos-step__body">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </HeroProvider>
  );
}
