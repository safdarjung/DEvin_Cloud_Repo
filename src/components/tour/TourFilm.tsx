"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { Mouse } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type RefObject } from "react";
import { STOPS, TOUR_UNITS, dwellAmount, stopIndexAt } from "./path";
import type { TourRoleKey } from "./roles";
import { FinaleCard, GateCard, RoleCard, accentVar, roleAt, stopAccent, stopLabel } from "./TourCards";

gsap.registerPlugin(ScrollTrigger);

const TourCanvas = dynamic(() => import("./scene/TourCanvas"), { ssr: false });

/** Scroll length: viewport heights per path unit (≈ one screen per segment). */
export const SCROLL_VH = TOUR_UNITS * 90;

interface FilmProps {
  lite: boolean;
  rootRef: RefObject<HTMLDivElement | null>;
  lenisRef: RefObject<Lenis | null>;
  onJump: (i: number) => void;
  onFeatures: (key: TourRoleKey) => void;
}

/** The 3D scroll film: sticky canvas, one DOM card per stop, a progress bar and a labelled rail. */
export function TourFilm({ lite, rootRef, lenisRef, onJump, onFeatures }: FilmProps) {
  const progress = useRef(0);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // Same Lenis + ScrollTrigger wiring as the landing film (src/components/landing/film.tsx).
    const smooth = new Lenis();
    lenisRef.current = smooth;
    smooth.on("scroll", ScrollTrigger.update);
    const raf = (time: number) => smooth.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    const paint = (p: number) => {
      progress.current = p;
      el.style.setProperty("--p", p.toFixed(4));
      el.toggleAttribute("data-moved", p > 0.012);
      cards.current.forEach((card, i) => {
        if (card) card.dataset.on = String(dwellAmount(p, STOPS[i]) > 0.5);
      });
    };
    const st = ScrollTrigger.create({
      trigger: el,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        paint(self.progress);
        setActive(stopIndexAt(self.progress));
      },
    });
    paint(st.progress);
    const first = requestAnimationFrame(() => setActive(stopIndexAt(st.progress)));
    const refresh = () => ScrollTrigger.refresh();
    window.addEventListener("load", refresh, { once: true });

    return () => {
      cancelAnimationFrame(first);
      window.removeEventListener("load", refresh);
      st.kill();
      gsap.ticker.remove(raf);
      gsap.ticker.lagSmoothing(500, 33);
      smooth.destroy();
      lenisRef.current = null;
    };
  }, [rootRef, lenisRef]);

  return (
    <div ref={rootRef} className="tour-film" data-ready={ready || undefined} style={{ height: `${SCROLL_VH + 100}vh` }}>
      <div className="tour-stage">
        <div className="tour-canvas" aria-hidden="true">
          <TourCanvas progress={progress} lite={lite} onReady={() => setReady(true)} />
        </div>
        <div className="tour-loader" aria-hidden="true">
          <div className="tour-loader-blob">
            <span />
            <span />
          </div>
          <p>Opening the school gates…</p>
        </div>
        <div className="tour-progress" aria-hidden="true">
          <span />
        </div>
        <p className="tour-scrollhint" aria-hidden="true">
          <Mouse className="size-5" />
          Scroll to walk in
        </p>
        <nav className="tour-rail" aria-label="Tour stops">
          <ol>
            {STOPS.map((s, i) => (
              <li key={s.key}>
                <button type="button" style={accentVar(stopAccent(s.key))} aria-current={active === i ? "step" : undefined} onClick={() => onJump(i)}>
                  <span className="tour-rail-label">{stopLabel(s.key)}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      </div>
      {STOPS.map((s, i) => {
        const role = roleAt(s.key);
        return (
          <section
            key={s.key}
            id={`tour-${s.key}`}
            className="tour-stop"
            data-stop={s.key}
            aria-labelledby={`tour-${s.key}-title`}
            style={{ top: `${s.start * SCROLL_VH}vh`, height: `${(s.end - s.start) * SCROLL_VH + 100}vh` }}
          >
            <div className="tour-pin">
              <div
                ref={(node) => {
                  cards.current[i] = node;
                }}
                className="tour-card"
                data-on="true"
                style={accentVar(role?.accent)}
              >
                {role ? <RoleCard role={role} index={i} onFeatures={onFeatures} /> : s.key === "gate" ? <GateCard film onStart={() => onJump(1)} /> : <FinaleCard />}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
