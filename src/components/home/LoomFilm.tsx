"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { ArrowDown, ArrowRight, MousePointer2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { FilmButton } from "./FilmButton";
import { ACTS, actAt, problemAt, problemWindow } from "./loom/weave";
import Scene3D from "./scene/Scene3D";
import { HOME_STATS } from "./stats";
import { HONESTY_TEXT, PROBLEMS, TAGLINE, THREAD } from "./story";
import { WeaveArt } from "./WeaveArt";

gsap.registerPlugin(ScrollTrigger);

const REDUCED = "(prefers-reduced-motion: reduce)";
const NARROW = "(max-width: 899px)";
type Mode = "film" | "static";

/** Scroll length of the film in viewport heights: hero, one stretch per problem, the weave, a short hold. */
const FILM_VH = 660;
/** Height of the sticky site header the stage pins under (h-16); `--header` in home.css is the same value. */
const HEADER_PX = 64;
/** Card on screen: -1 hero, 0..n-1 a problem, n the weave. */
const WEAVE_CARD = PROBLEMS.length;

function subscribe(onChange: () => void) {
  const queries = [REDUCED, NARROW].map((q) => window.matchMedia(q));
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}
const getMode = (): Mode => (window.matchMedia(REDUCED).matches ? "static" : "film");
const getLite = () => window.matchMedia(NARROW).matches;

const cardAt = (p: number) => (actAt(p) === "hero" ? -1 : actAt(p) === "problems" ? problemAt(p) : WEAVE_CARD);
/** Progress to scroll to so that card i is settled on screen. */
const cardProgress = (i: number) => (i < 0 ? 0 : i >= WEAVE_CARD ? ACTS.hold[0] : problemWindow(i)[0] + (problemWindow(i)[1] - problemWindow(i)[0]) * 0.62);
/** The headline, one span per word so each can rise in on its own beat (home-motion.css). */
const HERO_WORDS = ["The", "whole", "school,", "woven", "into", "one", "system."];
const threadVar = (color: string) => ({ "--thread": color }) as CSSProperties;

/**
 * The opening act of the landing page. With motion allowed it is a pinned scroll film beside a 3D scene
 * (scene/Scene3D.tsx): seven loose paper things float round one product board; each scroll step brings one
 * forward, flips it into the screen that replaces it and docks it into the board. With reduced motion (and
 * before hydration) the same copy is an ordinary stacked page with a drawn swatch, so nothing depends on 3D.
 */
export function LoomFilm() {
  const mode = useSyncExternalStore(subscribe, getMode, () => "static" as Mode);
  const lite = useSyncExternalStore(subscribe, getLite, () => false);
  const root = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const lenis = useRef<Lenis | null>(null);
  const [card, setCard] = useState(-1);
  const [inView, setInView] = useState(true);
  const [ready, setReady] = useState(false);
  const film = mode === "film";

  useEffect(() => {
    const el = root.current;
    if (!film || !el) return;
    // Same Lenis + ScrollTrigger wiring as the school tour (src/components/tour/TourFilm.tsx).
    const smooth = new Lenis({ anchors: true });
    lenis.current = smooth;
    smooth.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => smooth.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);
    const paint = (p: number) => {
      progress.current = p;
      el.style.setProperty("--p", p.toFixed(4));
      el.toggleAttribute("data-moved", p > 0.01);
      setCard(cardAt(p));
    };
    const st = ScrollTrigger.create({ trigger: el, start: `top ${HEADER_PX}px`, end: "bottom bottom", onUpdate: (self) => paint(self.progress) });
    paint(st.progress);
    const seen = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin: "20% 0px" });
    seen.observe(el);
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh, { once: true });
    // A card taller than the room the stage has for it (a short window, a large font) is scaled to fit, so
    // its buttons never slide under the header or the story rail.
    const copy = el.querySelector<HTMLElement>(".lf-copy");
    const cards = [...el.querySelectorAll<HTMLElement>(".lf-card")];
    const fit = () => {
      if (!copy) return;
      const style = getComputedStyle(copy);
      const room = copy.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      for (const c of cards) c.style.setProperty("--fit", Math.min(1, room / c.offsetHeight).toFixed(3));
    };
    const sized = new ResizeObserver(fit);
    if (copy) sized.observe(copy);
    cards.forEach((c) => sized.observe(c));
    return () => {
      window.removeEventListener("load", refresh);
      sized.disconnect();
      cards.forEach((c) => c.style.removeProperty("--fit"));
      seen.disconnect();
      st.kill();
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33);
      smooth.destroy();
      lenis.current = null;
    };
  }, [film]);

  const jump = (i: number) => {
    const el = root.current;
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - HEADER_PX + cardProgress(i) * (el.offsetHeight - window.innerHeight + HEADER_PX);
    if (lenis.current) lenis.current.scrollTo(y, { duration: 1.6 });
    else window.scrollTo({ top: y });
  };

  const on = (i: number) => (film ? card === i : true);

  return (
    <div ref={root} id="top" className="lf" data-mode={mode} data-ready={ready || undefined} style={film ? { height: `${FILM_VH}vh` } : undefined}>
      <div className="lf-stage lm-dots">
        {film && (
          <div className="lf-canvas" aria-hidden="true">
            <Scene3D progress={progress} current={card} lite={lite} active={inView} onPick={jump} onReady={() => setReady(true)} />
          </div>
        )}

        <div className="lf-copy">
          <header className="lf-card lf-hero" data-on={on(-1)} inert={film && card !== -1}>
            <p className="lm-eyebrow">
              <span className="lh-mark" aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
              </span>
              Fabric · school operating system
            </p>
            <h1 className="lm-display lf-h1">
              {HERO_WORDS.map((word, i) => (
                <Fragment key={word}>
                  <span className={word === "woven" ? "lf-w lf-woven" : "lf-w"} style={{ "--i": i } as CSSProperties}>
                    {word}
                  </span>{" "}
                </Fragment>
              ))}
            </h1>
            <p className="lm-lead lf-lead">
              A school runs on loose threads: a paper register, a receipt book, five WhatsApp groups. Fabric puts attendance, fees, exams, admissions and{" "}
              {HOME_STATS.modules - 4} more modules on one record, with AI that drafts while your people decide.
            </p>
            <div className="lf-actions">
              <Link href="/demo" className="lm-btn">
                Try a demo <ArrowRight aria-hidden className="size-4" />
              </Link>
              <FilmButton kind="paper" />
            </div>
            <p className="lf-sub">
              No sign-up: pick a role and look around a sample school. Or{" "}
              <Link href="/tour" className="lh-link">
                walk the school in 3D
              </Link>
              .
            </p>
            <WeaveArt className="lf-swatch" />
          </header>

          <ol className="lf-problems" aria-label="Seven loose threads a school runs on today">
            {PROBLEMS.map((p, i) => (
              <li key={p.thread} className="lf-card lf-problem" data-on={on(i)} style={threadVar(THREAD[p.thread].color)}>
                <p className="lf-count">
                  <span className="lf-bead" aria-hidden="true" />
                  Loose thread {i + 1} of {PROBLEMS.length} · {p.artefact}
                </p>
                <h2 className="lm-display lf-pain">{p.pain}</h2>
                <p className="lf-detail">{p.detail}</p>
                <div className="lf-fix">
                  <p className="lf-fix-label">With Fabric</p>
                  <p className="lf-fix-text">{p.fix}</p>
                  {p.label && (
                    <p className="lf-note">
                      <span className="lm-honest">{HONESTY_TEXT[p.label]}</span> {p.labelNote}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <section className="lf-card lf-weave" data-on={on(WEAVE_CARD)} inert={film && card !== WEAVE_CARD} aria-labelledby="lf-weave-title">
            <p className="lm-eyebrow">The idea</p>
            <h2 id="lf-weave-title" className="lm-display lf-pain">
              One record. Every thread connected.
            </h2>
            <p className="lf-detail">
              Mark the register once and the parent, the office and the principal are reading the same row. Raise an invoice and the dues list, the receipt and the
              projection move together. {TAGLINE}
            </p>
            <a href="#stories" className="lm-btn">
              See it happen <ArrowDown aria-hidden className="size-4" />
            </a>
          </section>
        </div>

        {film && (
          <>
            <nav className="lf-rail" aria-label="Opening story">
              <ol>
                {[-1, ...PROBLEMS.map((_, i) => i), WEAVE_CARD].map((i) => {
                  const p = i >= 0 && i < WEAVE_CARD ? PROBLEMS[i] : null;
                  const label = i < 0 ? "Start" : p ? p.artefact : "One record";
                  return (
                    <li key={i}>
                      <button type="button" className="lm-focus" style={p ? threadVar(THREAD[p.thread].color) : undefined} aria-current={card === i ? "step" : undefined} onClick={() => jump(i)}>
                        <span className="sr-only">{label}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="lf-hint" aria-hidden="true">
                <MousePointer2 className="size-4" />
                Scroll: each loose paper becomes part of one record. Click a card to turn it over.
              </p>
              <a href="#stories" className="lf-skip lm-focus">
                Skip the story
              </a>
            </nav>
          </>
        )}
      </div>
    </div>
  );
}
