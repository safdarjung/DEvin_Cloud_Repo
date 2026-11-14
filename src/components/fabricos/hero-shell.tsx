"use client";

// Client islands for the FabricOS hero. The server-rendered text is passed in
// as children, so hydration covers only state, the stage layer and the node
// explorer. One provider owns: active story stage, selected/hovered node,
// layout tier and whether the WebGL scene may run.
import dynamic from "next/dynamic";
import { createContext, use, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NODES, type NodeKind } from "./content";
import { HeroFallback } from "./hero-fallback";
import { HERO_STAGE } from "./scene/layout";

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false, loading: () => null });

type Mode = "pending" | "gl" | "static";

interface HeroState {
  stage: number;
  selected: string | null;
  hovered: string | null;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  wide: boolean;
  lite: boolean;
  inView: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
}

const Ctx = createContext<HeroState | null>(null);
const useHero = () => {
  const v = use(Ctx);
  if (!v) throw new Error("HeroStory islands must render inside <HeroProvider>");
  return v;
};

function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** No WebGL, data saver, or very small CPU/memory budgets: keep the static picture. */
function canRunGL() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return false;
  if ((nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2) return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

export function HeroProvider({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(HERO_STAGE);
  const [selected, select] = useState<string | null>(null);
  const [hovered, hover] = useState<string | null>(null);
  const [inView, setInView] = useState(true);
  const [glOk, setGlOk] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const wide = useMedia("(min-width: 960px)");
  const lite = useMedia("(max-width: 640px), (pointer: coarse)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  // Active stage: whichever block crosses the viewport's middle line.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const blocks = el.querySelectorAll<HTMLElement>("[data-hs-step]");
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const v = (en.target as HTMLElement).dataset.hsStep;
          setStage(v === "hero" ? HERO_STAGE : Number(v));
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    blocks.forEach((b) => io.observe(b));
    setReady(true);
    return () => io.disconnect();
  }, []);

  // Pause rendering when the whole hero/story is off-screen or the tab is hidden.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let visible = true;
    let shown = !document.hidden;
    const sync = () => setInView(visible && shown);
    const io = new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      sync();
    });
    const onVis = () => {
      shown = !document.hidden;
      sync();
    };
    io.observe(el);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Decide once the browser is idle: WebGL scene or permanent static fallback.
  useEffect(() => {
    if (reduced) return;
    const decide = () => setGlOk((prev) => (prev === false ? false : canRunGL()));
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(decide, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(decide, 300);
    return () => clearTimeout(id);
  }, [reduced]);
  const mode: Mode = reduced || glOk === false ? "static" : glOk ? "gl" : "pending";
  const setMode = useCallback((m: Mode) => setGlOk(m === "gl"), []);

  const value: HeroState = { stage, selected, hovered, select, hover, wide, lite, inView, mode, setMode };
  return (
    <Ctx value={value}>
      <div ref={root} className="fos-hs" data-stage={stage === HERO_STAGE ? "hero" : stage} data-ready={ready ? "" : undefined}>
        {children}
      </div>
    </Ctx>
  );
}

/** Sticky visual layer: static SVG first, WebGL scene faded in over it when allowed. */
export function HeroStage() {
  const { stage, selected, hovered, select, hover, wide, lite, inView, mode, setMode } = useHero();
  const [glReady, setGlReady] = useState(false);
  const onReady = useCallback(() => setGlReady(true), []);
  const onLost = useCallback(() => setMode("static"), [setMode]);
  const showGL = mode === "gl";
  return (
    <div className="fos-hs__stage" aria-hidden>
      <div className="fos-hs__pin" data-gl={showGL && glReady ? "ready" : undefined}>
        <HeroFallback selected={selected} />
        {showGL ? (
          <HeroScene
            stage={stage}
            selected={selected}
            hovered={hovered}
            onHover={hover}
            onSelect={select}
            wide={wide}
            lite={lite}
            running={inView}
            onReady={onReady}
            onLost={onLost}
          />
        ) : null}
      </div>
    </div>
  );
}

const GLYPH: Record<NodeKind, ReactNode> = {
  core: <path d="M6 1.5 10 3.75v4.5L6 10.5 2 8.25v-4.5Z" />,
  people: <circle cx="6" cy="6" r="3.5" />,
  agent: <path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" />,
  information: <path d="M2 3.5h8M2 6h8M2 8.5h8" />,
  workflow: <circle cx="6" cy="6" r="3.5" fill="none" />,
  automation: <path d="M9.5 6a3.5 3.5 0 1 1-1-2.45M9.5 2v2.5H7" fill="none" />,
  insight: <path d="M6 1.5 10 10H2Z" />,
};

/** Accessible, non-3D way to explore the same nodes. Drives the scene's highlight. */
export function HeroExplorer() {
  const { selected, select, hover } = useHero();
  const node = NODES.find((n) => n.id === selected);
  return (
    <div className="fos-xp" role="group" aria-labelledby="fos-xp-title">
      <p id="fos-xp-title" className="fos-xp__title">
        Explore the system
      </p>
      <ul className="fos-xp__list">
        {NODES.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className="fos-xp__btn"
              aria-pressed={selected === n.id}
              data-kind={n.kind}
              onClick={() => select(selected === n.id ? null : n.id)}
              onPointerEnter={() => hover(n.id)}
              onPointerLeave={() => hover(null)}
              onFocus={() => hover(n.id)}
              onBlur={() => hover(null)}
            >
              <svg viewBox="0 0 12 12" aria-hidden className="fos-xp__glyph">
                {GLYPH[n.kind]}
              </svg>
              {n.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="fos-xp__panel" aria-live="polite">
        {node ? (
          <>
            <p className="fos-xp__name">{node.label}</p>
            <p className="fos-xp__blurb">{node.blurb}</p>
          </>
        ) : (
          <p className="fos-xp__hint">Select a part of the system, here or in the scene, to see what it does.</p>
        )}
      </div>
    </div>
  );
}
