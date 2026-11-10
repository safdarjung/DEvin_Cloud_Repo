"use client";

// A sphere made of icons (OrbStage, one draw call from a baked atlas): one per
// app and one per enabled AI feature. The DOM here is input handling, ONE
// projected label (a real link, or a button that starts the feature's prompt)
// for the hovered / snapped icon, and a visually-hidden list so every item is
// reachable by keyboard and screen reader.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Search } from "lucide-react";
import { ORB_ICONS, type OrbIconKey } from "./orb-icons";
import type { Texture } from "three";
import { bakeAtlas, cssColor } from "./orb-atlas";
import type { OrbChip } from "./orb-chips";
import { featureSlots, fibonacciSphere, frontIndex, frontRotationNear, matchApp, pickDot, type OrbState } from "./orb-layout";
import { CAMERA_Z, FOV, OrbStage, type OrbShared, type OrbSignals } from "./OrbStage";
import { groupHue } from "./orb-theme";

export type { OrbSignals };

export interface OrbApp {
  href: string;
  label: string;
  icon: OrbIconKey;
  group: string;
}

const DRAG_PX_TO_RAD = 0.006;
const CLICK_SLOP_PX = 6;
/** Pointer reach around an icon, in px (touch gets more). */
const REACH_PX = 24;
const TOUCH_REACH_PX = 34;
/** Wheel px -> spin impulse (rad/s): one mouse notch coasts about one icon. */
const WHEEL_GAIN = 0.016;
const MAX_SPIN = 9;
/** How long a wheel snap / a touch tap keeps its icon highlighted without further input. */
const SNAP_HOLD_MS = 2000;
const TAP_HOLD_MS = 5000;
/** Reduced motion: wheel travel per icon step, and the pause between steps. */
const STEP_PX = 40;
const STEP_MS = 140;

// hover() runs only from event handlers and effects; the purity lint cannot see that through open()/snap().
const now = () => performance.now();
const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One icon on the sphere: an app (link) or an AI feature (starts its prompt, or links to its page). */
interface OrbItem {
  key: string;
  label: string;
  sub: string;
  icon: OrbIconKey;
  feature: boolean;
  tint: string;
  href?: string;
  prompt?: string;
}

const FEATURE_SUB = { ask: "AI · ask", create: "AI · create", open: "AI · opens its page" } as const;

interface SceneProps {
  apps: OrbApp[];
  /** Enabled AI capabilities (the same list as the chips). */
  features: OrbChip[];
  /** Start a feature's starter prompt in the chat. */
  onPrompt: (text: string) => void;
  state: OrbState;
  reduced: boolean;
  dark: boolean;
  accent: readonly [string, string];
  signals: React.RefObject<OrbSignals>;
}

export default function OrbScene({ apps, features, onPrompt, state, reduced, dark, accent, signals }: SceneProps) {
  const router = useRouter();
  // Apps and AI features share one lattice, features interleaved evenly (featureSlots).
  const items = useMemo<OrbItem[]>(() => {
    const queue = { app: [...apps], feature: [...features] };
    return featureSlots(apps.length, features.length).flatMap((isFeature): OrbItem[] => {
      const f = isFeature ? queue.feature.shift() : undefined;
      const a = isFeature ? undefined : queue.app.shift();
      if (f) return [{ key: `ai:${f.key}`, label: f.label, sub: FEATURE_SUB[f.kind], icon: f.icon, feature: true, tint: accent[dark ? 1 : 0], href: f.href, prompt: f.prompt }];
      if (a) return [{ key: a.href, label: a.label, sub: a.group, icon: a.icon, feature: false, tint: groupHue(a.group), href: a.href }];
      return [];
    });
  }, [apps, features, accent, dark]);
  const iconKeys = useMemo(() => [...new Set(items.map((it) => it.icon))], [items]);
  const sprites = useMemo(() => items.map((it) => ({ feature: it.feature, cell: iconKeys.indexOf(it.icon), tint: it.tint })), [items, iconKeys]);
  // Same lattice OrbStage builds its icons from (dotField).
  const normals = useMemo(() => fibonacciSphere(items.length), [items.length]);
  const shared = useRef<OrbShared>({
    rot: { y: 0, x: 0, vy: 0, vx: 0, dragging: false },
    target: null,
    hovered: null,
    // Idle rotation runs from the first frame.
    lastInput: -Infinity,
    wheelAt: -Infinity,
    coasting: false,
    holdMs: 0,
    kick: 0,
    screen: new Float32Array(items.length * 3).fill(-1),
    invalidate: () => {},
  });
  const box = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLElement | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [atlas, setAtlas] = useState<Texture | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const glow = useRef<HTMLDivElement>(null);
  const links = useRef<Array<HTMLElement | null>>([]);
  const moved = useRef(0);
  const snapping = useRef(false);
  const tapRevealed = useRef(false);
  const [hot, setHot] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  function hover(i: number | null, bringFront = false, holdMs = 0) {
    const sh = shared.current;
    sh.hovered = i;
    sh.holdMs = i === null ? 0 : holdMs;
    sh.lastInput = now();
    sh.target = i !== null && bringFront ? frontRotationNear(normals[i], sh.rot.y, sh.rot.x) : null;
    sh.invalidate();
    setHot(i);
  }

  /** Wheel settle: bring icon i front-centre, highlight it, pulse the sphere. Enter opens it (its link/button takes focus). */
  function snap(i: number | null) {
    if (i === null || i < 0) return hover(null);
    hover(i, true, SNAP_HOLD_MS);
    shared.current.kick = 1;
    // Don't steal focus from someone typing a question.
    if (document.activeElement?.matches("input, textarea")) return;
    snapping.current = true;
    links.current[i]?.focus({ preventScroll: true });
    snapping.current = false;
  }

  function onSearch(q: string) {
    setQuery(q);
    const i = matchApp(items.map((it) => it.label), q);
    hover(i >= 0 ? i : null, i >= 0);
  }

  function open(it: OrbItem) {
    if (it.href) router.push(it.href);
    else if (it.prompt) {
      hover(null);
      onPrompt(it.prompt);
    }
  }

  // Bake the icons this role needs into the atlas once (from the hidden sprite sheet below).
  useEffect(() => {
    let live = true;
    let made: Texture | null = null;
    bakeAtlas([...(sheet.current?.querySelectorAll("svg") ?? [])]).then(
      (tex) => {
        made = tex;
        if (live) setAtlas(tex);
        else tex.dispose();
      },
      // No atlas, no sphere: the hidden list below still reaches every item.
      () => {},
    );
    return () => {
      live = false;
      made?.dispose();
    };
  }, [iconKeys]);
  // Icon chips are drawn in the page's card colour, which follows the theme.
  useEffect(() => {
    if (box.current) setCard(cssColor("var(--card)", box.current));
  }, [dark]);

  const act = useRef({ snap, hover });
  useEffect(() => {
    act.current = { snap, hover };
  });

  // Wheel / trackpad spins the sphere; the page must not scroll under the orb (non-passive listener).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let acc = 0;
    let steppedAt = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const sh = shared.current;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      if (e.shiftKey && dx === 0) [dx, dy] = [dy, 0];
      const now = performance.now();
      if (reduced) {
        // No momentum: step from icon to icon.
        sh.lastInput = sh.wheelAt = now;
        acc += dx + dy;
        if (Math.abs(acc) < STEP_PX || now - steppedAt < STEP_MS) return;
        const cur = sh.hovered ?? frontIndex(normals, sh.rot.y, sh.rot.x);
        const next = (cur + Math.sign(acc) + normals.length) % normals.length;
        acc = 0;
        steppedAt = now;
        act.current.snap(next);
        return;
      }
      if (sh.hovered !== null || sh.target) act.current.hover(null);
      sh.lastInput = sh.wheelAt = now;
      sh.coasting = true;
      // Wheel down rolls icons up over the front (like page content); horizontal turns about the vertical axis.
      sh.rot.vx = clamp(sh.rot.vx - dy * WHEEL_GAIN, -MAX_SPIN, MAX_SPIN);
      sh.rot.vy = clamp(sh.rot.vy - dx * WHEEL_GAIN, -MAX_SPIN, MAX_SPIN);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [normals, reduced]);

  /** Icon under the pointer, or -1. */
  function dotAt(e: { clientX: number; clientY: number; pointerType: string }): number {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return -1;
    const reach = e.pointerType === "mouse" ? REACH_PX : TOUCH_REACH_PX;
    return pickDot(shared.current.screen, e.clientX - rect.left, e.clientY - rect.top, reach);
  }

  function onPointerDown(e: React.PointerEvent) {
    const onChrome = (e.target as HTMLElement).closest("input, [data-orb-label]");
    if (e.button !== 0 || (onChrome && onChrome.tagName === "INPUT")) return;
    const sh = shared.current;
    const r = sh.rot;
    // Touch has no hover: a tap reveals the icon's label, a second tap (on the label) opens it.
    tapRevealed.current = false;
    if (!onChrome) {
      const i = dotAt(e);
      if (e.pointerType !== "mouse") {
        // The label appears under the finger; this same tap must not open it.
        tapRevealed.current = i >= 0;
        hover(i >= 0 ? i : null, false, TAP_HOLD_MS);
      }
      else if (sh.holdMs > 0 && i !== sh.hovered) hover(i >= 0 ? i : null);
    }
    sh.target = null;
    sh.coasting = false;
    r.dragging = true;
    r.vx = r.vy = 0;
    moved.current = 0;
    let lx = e.clientX, ly = e.clientY, lt = performance.now();
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lx, dy = ev.clientY - ly;
      const now = performance.now();
      const span = Math.max(8, now - lt) / 1000;
      lx = ev.clientX; ly = ev.clientY; lt = now;
      sh.lastInput = now;
      moved.current += Math.abs(dx) + Math.abs(dy);
      r.y += dx * DRAG_PX_TO_RAD;
      r.x += dy * DRAG_PX_TO_RAD;
      r.vy = lerp(r.vy, (dx * DRAG_PX_TO_RAD) / span, 0.5);
      r.vx = lerp(r.vx, (dy * DRAG_PX_TO_RAD) / span, 0.5);
      sh.invalidate();
    };
    const up = () => {
      r.dragging = false;
      sh.lastInput = performance.now();
      // A pause before release means no fling; reduced motion never flings.
      if (reduced || performance.now() - lt > 80) r.vx = r.vy = 0;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  /** Mouse hover: the icon under the pointer bulges. Icons sliding under a still pointer during a wheel spin do not count. */
  function onPointerMove(e: React.PointerEvent) {
    const sh = shared.current;
    if (e.pointerType !== "mouse" || sh.rot.dragging || sh.coasting) return;
    sh.lastInput = performance.now();
    // Over the label: it belongs to the hovered icon.
    if ((e.target as HTMLElement).closest("[data-orb-label]")) return;
    const i = dotAt(e);
    if (i >= 0 ? i !== sh.hovered : sh.hovered !== null && sh.holdMs === 0 && !sh.target) hover(i >= 0 ? i : null);
  }

  const hotItem = hot !== null ? items[hot] : undefined;
  const labelClass = "group/label absolute left-0 top-0 z-10 flex cursor-pointer items-center opacity-0 outline-none will-change-transform data-[side=left]:flex-row-reverse";
  // The round end sits on the bulged icon, so clicking the icon itself opens it.
  const labelBody = hotItem && (
    <>
      <span className="size-20 shrink-0 rounded-full" />
      <span
        className="flex flex-col rounded-2xl border bg-card/95 px-3 py-1.5 text-left leading-tight shadow-[0_18px_44px_-18px_rgb(0_0_0/0.6)] backdrop-blur group-data-[side=left]/label:items-end group-data-[side=left]/label:text-right"
        style={{ borderColor: `color-mix(in oklab, ${hotItem.tint} 55%, var(--border))` }}
      >
        <span className="whitespace-nowrap text-sm font-semibold text-foreground">{hotItem.label}</span>
        <span className="whitespace-nowrap text-[11px] text-muted-foreground">{hotItem.sub}</span>
      </span>
    </>
  );

  return (
    <div
      ref={box}
      className={`relative isolate size-full touch-none select-none overflow-hidden [container:orb/size] ${hotItem ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={(e) => e.pointerType === "mouse" && shared.current.hovered !== null && shared.current.holdMs === 0 && !shared.current.target && hover(null)}
      // A drag that ends over the label must not open it; nor the tap that revealed it.
      onClickCapture={(e) => {
        if (moved.current > CLICK_SLOP_PX || tapRevealed.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div
        ref={glow}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${accent[1]} ${dark ? 20 : 14}%, transparent), transparent 82%)` }}
      />
      {/* Sprite sheet source: each needed lucide icon once, white, read by bakeAtlas; gone once baked. */}
      {!atlas && (
        <div ref={sheet} hidden>
          {iconKeys.map((k) => {
            const Icon = ORB_ICONS[k];
            return <Icon key={k} size={80} color="#fff" strokeWidth={1.9} />;
          })}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0">
        {atlas && card && (
          <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: FOV }} dpr={[1, 2]} frameloop={reduced ? "demand" : "always"} gl={{ antialias: true, alpha: true }}>
            <OrbStage sprites={sprites} atlas={atlas} card={card} state={state} reduced={reduced} dark={dark} accent={accent} shared={shared} signals={signals} label={label} glow={glow} onSnap={snap} />
          </Canvas>
        )}
      </div>
      {/* Every app and AI feature, for keyboard and screen readers: focus rotates the sphere to bring that icon front. */}
      <ul aria-label="Apps and AI features" className="sr-only">
        {items.map((it, i) => {
          const focus = { onFocus: () => !snapping.current && hover(i, true), onBlur: () => !snapping.current && shared.current.hovered === i && hover(null) };
          return (
            <li key={it.key}>
              {it.href ? (
                <Link ref={(el) => { links.current[i] = el; }} href={it.href} {...focus}>
                  {it.label} ({it.sub})
                </Link>
              ) : (
                <button ref={(el) => { links.current[i] = el; }} type="button" onClick={() => open(it)} {...focus}>
                  {it.label} ({it.sub})
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {/* Positioned every frame by OrbStage. */}
      {hotItem?.href && (
        <Link ref={(el) => { label.current = el; }} href={hotItem.href} data-orb-label tabIndex={-1} aria-hidden draggable={false} className={labelClass}>
          {labelBody}
        </Link>
      )}
      {hotItem && !hotItem.href && (
        <button ref={(el) => { label.current = el; }} type="button" data-orb-label tabIndex={-1} aria-hidden onClick={() => open(hotItem)} className={labelClass}>
          {labelBody}
        </button>
      )}
      <label className="absolute left-3 top-3 z-20 flex h-9 w-44 cursor-text items-center gap-2 rounded-full border border-border bg-card/90 px-3 text-sm shadow-sm backdrop-blur focus-within:ring-2 focus-within:ring-ring sm:w-52 [@container_orb_(max-height:20rem)]:hidden">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Find an app or AI feature</span>
        <input
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hotItem) open(hotItem);
            if (e.key === "Escape") onSearch("");
          }}
          onBlur={() => query && hover(null)}
          placeholder="Find an app"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>
      <p aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-2 z-20 px-3 text-center text-xs text-muted-foreground [@container_orb_(max-height:20rem)]:sr-only">
        {hotItem ? (
          <>
            <span className="font-medium text-foreground">{hotItem.label}</span> · Enter or click to {hotItem.href ? "open" : "ask"}
          </>
        ) : (
          `Each icon is an app or an AI feature (ringed) · ${apps.length} apps, ${features.length} AI · scroll or drag to spin`
        )}
      </p>
    </div>
  );
}
