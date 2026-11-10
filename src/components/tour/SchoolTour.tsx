"use client";

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import { ArrowDown, ArrowRight, Play, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { STOPS, TOUR_UNITS, dwellAmount, dwellCentre, stopIndexAt, type StopKey } from "./path";
import { TOUR_ROLES, type TourRole, type TourRoleKey } from "./roles";
import "./tour.css";

gsap.registerPlugin(ScrollTrigger);

const TourCanvas = dynamic(() => import("./scene/TourCanvas"), { ssr: false });
const ExplainerPlayer = dynamic(() => import("./explainer/ExplainerPlayer"), {
  ssr: false,
  loading: () => <p className="tour-player-wait">Loading…</p>,
});

/** Scroll length: viewport heights per path unit (≈ one screen per segment). */
const SCROLL_VH = TOUR_UNITS * 90;
const REDUCED = "(prefers-reduced-motion: reduce)";
const NARROW_PORTRAIT = "(max-width: 899px) and (orientation: portrait)";
const ROLE = Object.fromEntries(TOUR_ROLES.map((r) => [r.key, r])) as Record<TourRoleKey, TourRole>;
const roleAt = (key: StopKey) => (key === "gate" ? undefined : ROLE[key]);
const accentVar = (accent?: string) => ({ "--role": accent ?? "var(--mk-accent)" }) as CSSProperties;

/* ---------- film or fallback: decided on the client, SSR always renders the fallback ---------- */

let webgl: boolean | undefined;
function hasWebGL(): boolean {
  if (webgl === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2");
      webgl = !!gl;
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webgl = false;
    }
  }
  return webgl;
}
function subscribe(onChange: () => void) {
  const queries = [REDUCED, NARROW_PORTRAIT].map((q) => window.matchMedia(q));
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}
const canFilm = () => !window.matchMedia(REDUCED).matches && !window.matchMedia(NARROW_PORTRAIT).matches && hasWebGL();

/**
 * /tour: one continuous scroll film through a 3D school (gate → five rooms), with a DOM card per stop.
 * No WebGL, reduced motion or a narrow portrait screen get the same cards stacked, plus MP4s when present.
 */
export function SchoolTour({ videos }: { videos: readonly TourRoleKey[] }) {
  const film = useSyncExternalStore(subscribe, canFilm, () => false);
  const [openKey, setOpenKey] = useState<TourRoleKey | null>(null);
  const [ended, setEnded] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const lenis = useRef<Lenis | null>(null);
  const filmRoot = useRef<HTMLDivElement>(null);

  const jump = (i: number) => {
    const stop = STOPS[i];
    const el = filmRoot.current;
    if (!stop) return;
    if (!el) {
      const smooth = !window.matchMedia(REDUCED).matches;
      document.getElementById(`tour-${stop.key}`)?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      return;
    }
    const y = el.getBoundingClientRect().top + window.scrollY + dwellCentre(stop) * (el.offsetHeight - window.innerHeight);
    if (lenis.current) lenis.current.scrollTo(y, { duration: 2.2 });
    else window.scrollTo({ top: y });
  };

  const openFeatures = (key: TourRoleKey) => {
    setOpenKey(key);
    setEnded(false);
    lenis.current?.stop();
    dialog.current?.showModal();
  };

  const openRole = openKey ? ROLE[openKey] : undefined;
  const nextIndex = openKey ? STOPS.findIndex((s) => s.key === openKey) + 1 : -1;
  const next = STOPS[nextIndex] ? roleAt(STOPS[nextIndex].key) : undefined;

  const goNext = () => {
    dialog.current?.close();
    lenis.current?.start();
    jump(nextIndex);
  };

  return (
    <div className="tour-root">
      {film ? (
        <Film rootRef={filmRoot} lenisRef={lenis} onJump={jump} onFeatures={openFeatures} />
      ) : (
        <StaticTour videos={videos} onJump={jump} onFeatures={openFeatures} />
      )}
      <dialog
        ref={dialog}
        className="tour-dialog"
        aria-labelledby="tour-dialog-title"
        data-lenis-prevent
        style={accentVar(openRole?.accent)}
        onClose={() => {
          setOpenKey(null);
          lenis.current?.start();
        }}
      >
        {openRole && (
          <>
            <div className="tour-dialog-head">
              <h2 id="tour-dialog-title">What Fabric does for the {openRole.label.toLowerCase()}</h2>
              <form method="dialog">
                <button type="submit" className="tour-icon-btn" aria-label="Close">
                  <X aria-hidden className="size-5" />
                </button>
              </form>
            </div>
            <div className="tour-player">
              <ExplainerPlayer key={openRole.key} role={openRole.key} onEnded={() => setEnded(true)} />
            </div>
            <div className="tour-dialog-foot">
              <DemoForm role={openRole} />
              {ended && next && (
                <button type="button" className="tour-btn" style={accentVar(next.accent)} onClick={goNext}>
                  Next: {next.label} <ArrowRight aria-hidden className="size-4" />
                </button>
              )}
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

/* ---------- film ---------- */

interface FilmProps {
  rootRef: RefObject<HTMLDivElement | null>;
  lenisRef: RefObject<Lenis | null>;
  onJump: (i: number) => void;
  onFeatures: (key: TourRoleKey) => void;
}

function Film({ rootRef, lenisRef, onJump, onFeatures }: FilmProps) {
  const progress = useRef(0);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const [active, setActive] = useState(0);

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
      cards.current.forEach((card, i) => {
        if (!card) return;
        const v = dwellAmount(p, STOPS[i]);
        card.style.setProperty("--dwell", v.toFixed(3));
        card.dataset.on = String(v > 0.05);
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
    <div ref={rootRef} className="tour-film" style={{ height: `${SCROLL_VH + 100}vh` }}>
      <div className="tour-stage">
        <div className="tour-canvas" aria-hidden="true">
          <TourCanvas progress={progress} />
        </div>
        <nav className="tour-rail" aria-label="Tour stops">
          <ol>
            {STOPS.map((s, i) => (
              <li key={s.key}>
                <button type="button" style={accentVar(roleAt(s.key)?.accent)} aria-current={active === i ? "step" : undefined} onClick={() => onJump(i)}>
                  <span className="tour-rail-label">{roleAt(s.key)?.room ?? "School gate"}</span>
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
            aria-labelledby={`tour-${s.key}-title`}
            style={{ top: `${s.start * SCROLL_VH}vh`, height: `${(s.end - s.start) * SCROLL_VH + 100}vh` }}
          >
            <div className="tour-pin">
              <div
                ref={(node) => {
                  cards.current[i] = node;
                }}
                className="tour-card"
                data-on="false"
                style={accentVar(role?.accent)}
              >
                {role ? <RoleCard role={role} index={i} onFeatures={onFeatures} /> : <GateCard film onStart={() => onJump(1)} />}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ---------- fallback ---------- */

function StaticTour({ videos, onJump, onFeatures }: { videos: readonly TourRoleKey[]; onJump: (i: number) => void; onFeatures: (key: TourRoleKey) => void }) {
  return (
    <div className="tour-static">
      <section id="tour-gate" className="tour-static-stop" aria-labelledby="tour-gate-title">
        <div className="tour-card">
          <GateCard onStart={() => onJump(1)} />
        </div>
      </section>
      {TOUR_ROLES.map((role, i) => (
        <section key={role.key} id={`tour-${role.key}`} className="tour-static-stop" aria-labelledby={`tour-${role.key}-title`}>
          <div className="tour-card" style={accentVar(role.accent)}>
            <RoleCard role={role} index={i + 1} onFeatures={onFeatures} />
          </div>
          {videos.includes(role.key) && (
            <video className="tour-video" src={`/tour/${role.key}.mp4`} controls preload="none" playsInline aria-label={`${role.label}: feature overview video`} />
          )}
        </section>
      ))}
    </div>
  );
}

/* ---------- cards (shared by both modes) ---------- */

function GateCard({ film = false, onStart }: { film?: boolean; onStart: () => void }) {
  return (
    <>
      <p className="tour-eyebrow">School tour</p>
      <h1 id="tour-gate-title" className="tour-title">
        Walk through a school day
      </h1>
      <p className="tour-tagline">Five people keep a school running. Meet each of them, see what Fabric does for them, and try their demo.</p>
      <div className="tour-actions">
        <button type="button" className="tour-btn" onClick={onStart}>
          Start the tour <ArrowRight aria-hidden className="size-4" />
        </button>
      </div>
      <p className="tour-hint">
        <ArrowDown aria-hidden className="size-4" />
        {film ? "Scroll to open the gate. Poke the bell, the trees and the flag." : "Scroll down to meet each of them."}
      </p>
    </>
  );
}

function RoleCard({ role, index, onFeatures }: { role: TourRole; index: number; onFeatures: (key: TourRoleKey) => void }) {
  return (
    <>
      <p className="tour-eyebrow">
        <span className="tour-pill">
          Stop {index} of {TOUR_ROLES.length}
        </span>
        {role.room}
      </p>
      <h2 id={`tour-${role.key}-title`} className="tour-title">
        {role.label}
      </h2>
      <p className="tour-tagline">{role.tagline}</p>
      <div className="tour-actions">
        <button type="button" className="tour-btn" onClick={() => onFeatures(role.key)}>
          <Play aria-hidden className="size-4" />
          Show features<span className="sr-only"> for the {role.label.toLowerCase()}</span>
        </button>
        <DemoForm role={role} ghost />
      </div>
    </>
  );
}

/** Same as the /demo role cards: plain form, no JS, so an early click still submits natively. */
function DemoForm({ role, ghost = false }: { role: TourRole; ghost?: boolean }) {
  return (
    <form method="post" action="/api/public/demo-login">
      <input type="hidden" name="email" value={role.demoEmail} />
      <button type="submit" className={ghost ? "tour-btn tour-btn-ghost" : "tour-btn"}>
        Try the {role.label} demo <ArrowRight aria-hidden className="size-4" />
      </button>
    </form>
  );
}
