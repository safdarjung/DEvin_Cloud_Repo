"use client";

import type Lenis from "lenis";
import { ArrowRight, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { STOPS, dwellCentre, stopIndexAt } from "./path";
import { TOUR_ROLES, type TourRoleKey } from "./roles";
import { DemoForm, FinaleCard, GateCard, ROLE, RoleCard, accentVar, roleAt } from "./TourCards";
import { TourFilm } from "./TourFilm";
import "./tour.css";
import "./tour-cards.css";

const ExplainerPlayer = dynamic(() => import("./explainer/ExplainerPlayer"), {
  ssr: false,
  loading: () => <p className="tour-player-wait">Loading…</p>,
});

const REDUCED = "(prefers-reduced-motion: reduce)";
const NARROW = "(max-width: 899px)";
type Mode = "film" | "lite" | "static";

/* ---------- 3D, light 3D or static: decided on the client; SSR renders the film shell ---------- */

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
  const queries = [REDUCED, NARROW].map((q) => window.matchMedia(q));
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}
const getMode = (): Mode => (window.matchMedia(REDUCED).matches || !hasWebGL() ? "static" : window.matchMedia(NARROW).matches ? "lite" : "film");

/**
 * /tour: one continuous scroll film through a 3D school (gate → five rooms → garden finale), with a DOM card
 * per stop. Phones get a lighter 3D scene with the card docked at the bottom; no WebGL or reduced motion
 * get the same cards stacked, plus MP4s when present.
 */
export function SchoolTour({ videos }: { videos: readonly TourRoleKey[] }) {
  const mode = useSyncExternalStore(subscribe, getMode, () => "film" as Mode);
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
    if (lenis.current) lenis.current.scrollTo(y, { duration: 2.4 });
    else window.scrollTo({ top: y });
  };

  // Left / right arrows step between stops (up / down keep scrolling). Not while the explainer dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = filmRoot.current;
      if (!el || dialog.current?.open || e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      const here = stopIndexAt(-el.getBoundingClientRect().top / Math.max(1, el.offsetHeight - window.innerHeight));
      const next = here + (e.key === "ArrowRight" ? 1 : -1);
      if (next < 0 || next >= STOPS.length) return;
      e.preventDefault();
      jump(next);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const openFeatures = (key: TourRoleKey) => {
    setOpenKey(key);
    setEnded(false);
    lenis.current?.stop();
    dialog.current?.showModal();
  };

  const openRole = openKey ? ROLE[openKey] : undefined;
  const nextIndex = openKey ? STOPS.findIndex((s) => s.key === openKey) + 1 : -1;
  const nextStop = STOPS[nextIndex];
  const nextLabel = nextStop ? (roleAt(nextStop.key)?.label ?? "The finale") : undefined;

  const goNext = () => {
    dialog.current?.close();
    lenis.current?.start();
    jump(nextIndex);
  };

  return (
    <div className="tour-root" data-mode={mode}>
      {mode === "static" ? (
        <StaticTour videos={videos} onJump={jump} onFeatures={openFeatures} />
      ) : (
        <TourFilm lite={mode === "lite"} rootRef={filmRoot} lenisRef={lenis} onJump={jump} onFeatures={openFeatures} />
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
              {ended && nextLabel && (
                <button type="button" className="tour-btn" style={accentVar(nextStop && roleAt(nextStop.key)?.accent)} onClick={goNext}>
                  Next: {nextLabel} <ArrowRight aria-hidden className="size-4" />
                </button>
              )}
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}

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
      <section id="tour-finale" className="tour-static-stop" aria-labelledby="tour-finale-title">
        <div className="tour-card">
          <FinaleCard />
        </div>
      </section>
    </div>
  );
}
