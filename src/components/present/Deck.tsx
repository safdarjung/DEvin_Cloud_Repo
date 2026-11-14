"use client";

import { ChevronLeft, ChevronRight, LayoutGrid, Maximize, Minimize, NotebookText, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent, type TouchEvent } from "react";
import { display } from "@/components/home/fonts";
import { STORIES } from "@/components/home/story";
import "@/components/home/tokens.css";
import { deckReducer, formatHash, parseHash, type DeckAction, type DeckPos } from "./deck-nav";
import { FRAGS, SLIDES } from "./slide-meta";
// Base deck styles first, so each slide group's stylesheet (imported by ./slides) can override them.
import "./deck.css";
import { SLIDE_VIEWS } from "./slides";

const StoryPlayer = dynamic(() => import("@/components/home/film/StoryPlayer"), { ssr: false, loading: () => <p className="dk-wait">Loading…</p> });
const FilmPlayer = dynamic(() => import("@/components/home/film/FilmPlayer"), { ssr: false, loading: () => <p className="dk-wait">Loading…</p> });

const W = 1280;
const H = 720;
const COUNT = SLIDES.length;

/* ---------- external stores: URL hash, viewport scale, fullscreen ---------- */

const hashListeners = new Set<() => void>();
function subscribeHash(cb: () => void) {
  hashListeners.add(cb);
  window.addEventListener("hashchange", cb);
  return () => {
    hashListeners.delete(cb);
    window.removeEventListener("hashchange", cb);
  };
}
function writeHash(hash: string) {
  if (window.location.hash === hash) return;
  // replaceState keeps the browser's Back button for leaving the deck, not for every slide.
  window.history.replaceState(window.history.state, "", hash);
  hashListeners.forEach((l) => l());
}

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
const readScale = () => Math.min(window.innerWidth / W, window.innerHeight / H);

function subscribeFullscreen(cb: () => void) {
  document.addEventListener("fullscreenchange", cb);
  return () => document.removeEventListener("fullscreenchange", cb);
}
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

const SWIPE = 50;

export default function Deck() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const scale = useSyncExternalStore(subscribeResize, readScale, () => 1);
  const fullscreen = useSyncExternalStore(subscribeFullscreen, () => !!document.fullscreenElement, () => false);
  const slide = parseHash(hash, COUNT);
  // The step belongs to the slide it was set on; a slide reached any other way starts at step 0.
  const [frag, setFrag] = useState<DeckPos>({ slide: 0, step: 0 });
  const step = frag.slide === slide ? frag.step : 0;
  const [overview, setOverview] = useState(false);
  const [notes, setNotes] = useState(false);
  const [film, setFilm] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = (action: DeckAction) => {
    const next = deckReducer(FRAGS, { slide, step }, action);
    setFrag(next);
    writeHash(formatHash(next.slide));
  };

  const openFilm = (key: string) => {
    setFilm(key);
    dialog.current?.showModal();
  };

  // Re-bound each render so the handler always sees the current slide and step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || dialog.current?.open) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      const onControl = !!target?.closest("button, a");
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
          go({ type: "next" });
          break;
        case " ":
          if (onControl) return;
          go({ type: e.shiftKey ? "prev" : "next" });
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
          go({ type: "prev" });
          break;
        case "Home":
          go({ type: "first" });
          break;
        case "End":
          go({ type: "last" });
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
        case "o":
        case "O":
          setOverview((v) => !v);
          break;
        case "n":
        case "N":
          setNotes((v) => !v);
          break;
        case "Escape":
          if (!overview && !notes) return;
          setOverview(false);
          setNotes(false);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onViewClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target instanceof Element && e.target.closest("a, button, input, form, dialog, .dk-ui")) return;
    const x = e.clientX / window.innerWidth;
    if (x > 2 / 3) go({ type: "next" });
    else if (x < 1 / 3) go({ type: "prev" });
  };
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < Math.abs(t.clientY - start.y)) return;
    go({ type: dx < 0 ? "next" : "prev" });
  };

  const meta = SLIDES[slide] ?? SLIDES[0];
  const story = STORIES.find((s) => s.key === film);
  const progress = COUNT > 1 ? slide / (COUNT - 1) : 1;

  return (
    <main className={`loom ${display.variable} deck`} aria-label="Fabric presentation">
      <div className="dk-view" onClick={onViewClick} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="dk-stage lm-dots" style={{ "--s": scale } as CSSProperties}>
          {SLIDES.map((m, i) => {
            const View = SLIDE_VIEWS[m.id];
            const current = i === slide;
            return (
              <section
                key={m.id}
                className={`dk-slide dk-${m.id}`}
                aria-roledescription="slide"
                aria-label={`${i + 1} of ${COUNT}: ${m.title}`}
                data-pos={current ? "now" : i < slide ? "past" : "next"}
                inert={!current}
              >
                <View step={current ? step : i < slide ? m.frags : 0} onFilm={openFilm} />
              </section>
            );
          })}
        </div>
      </div>

      <div className="dk-progress" aria-hidden>
        <span style={{ transform: `scaleX(${progress})` }} />
      </div>

      <nav className="dk-ui dk-controls" aria-label="Slide controls">
        <button type="button" onClick={() => go({ type: "prev" })} aria-label="Previous" disabled={slide === 0 && step === 0}>
          <ChevronLeft aria-hidden />
        </button>
        <p className="dk-count" aria-live="polite">
          <span className="sr-only">Slide </span>
          {slide + 1} / {COUNT}
          <span className="sr-only">: {meta.title}</span>
        </p>
        <button type="button" onClick={() => go({ type: "next" })} aria-label="Next" disabled={slide === COUNT - 1 && step >= meta.frags}>
          <ChevronRight aria-hidden />
        </button>
        <button type="button" onClick={() => setOverview((v) => !v)} aria-label="All slides" aria-pressed={overview}>
          <LayoutGrid aria-hidden />
        </button>
        <button type="button" onClick={() => setNotes((v) => !v)} aria-label="Speaker notes" aria-pressed={notes}>
          <NotebookText aria-hidden />
        </button>
        <button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit full screen" : "Full screen"}>
          {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
        </button>
      </nav>

      {notes && (
        <aside className="dk-ui dk-notes" aria-label="Speaker notes">
          <p className="dk-notes-h">
            Notes · {slide + 1}. {meta.title}
            {meta.frags > 0 && ` · step ${step} of ${meta.frags}`}
          </p>
          <p>{meta.notes}</p>
          {SLIDES[slide + 1] && <p className="dk-notes-next">Next: {SLIDES[slide + 1]?.title}</p>}
        </aside>
      )}

      {overview && (
        <div className="dk-ui dk-overview" role="dialog" aria-modal="false" aria-label="All slides">
          <div className="dk-overview-head">
            <p className="lm-display">All slides</p>
            <button type="button" className="dk-close" onClick={() => setOverview(false)} aria-label="Close all slides">
              <X aria-hidden />
            </button>
          </div>
          <ol>
            {SLIDES.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  aria-current={i === slide ? "true" : undefined}
                  onClick={() => {
                    go({ type: "goto", slide: i });
                    setOverview(false);
                  }}
                >
                  <span className="lm-display">{i + 1}</span>
                  {m.title}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      <dialog ref={dialog} className="dk-film" aria-label={story ? `Film: ${story.title}` : "The 90-second film"} onClose={() => setFilm(null)}>
        <form method="dialog" className="dk-film-head">
          <p className="lm-display">{story ? story.title : "Fabric in 90 seconds"}</p>
          <button type="submit" className="dk-close" aria-label="Close film">
            <X aria-hidden />
          </button>
        </form>
        <div className="dk-film-body">
          {film === "film" && <FilmPlayer autoPlay />}
          {story && <StoryPlayer story={story} seek={null} autoPlay />}
        </div>
      </dialog>
    </main>
  );
}
