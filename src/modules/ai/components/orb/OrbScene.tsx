"use client";

// A sphere made only of dots (OrbStage, one draw call). Each bright dot is one
// of the person's apps; the DOM here is input handling, ONE projected label
// (a real link) for the hovered / snapped dot, and a visually-hidden link list
// so every app is reachable by keyboard and screen reader.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Search } from "lucide-react";
import { ORB_ICONS, type OrbIconKey } from "./orb-icons";
import { fibonacciSphere, frontIndex, frontRotationNear, matchApp, pickDot, type OrbState } from "./orb-layout";
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
/** Pointer reach around an app dot, in px (touch gets more). */
const REACH_PX = 22;
const TOUCH_REACH_PX = 34;
/** Wheel px -> spin impulse (rad/s): one mouse notch coasts about one app dot. */
const WHEEL_GAIN = 0.016;
const MAX_SPIN = 9;
/** How long a wheel snap / a touch tap keeps its dot highlighted without further input. */
const SNAP_HOLD_MS = 2000;
const TAP_HOLD_MS = 5000;
/** Reduced motion: wheel travel per dot step, and the pause between steps. */
const STEP_PX = 40;
const STEP_MS = 140;

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.min(1, k);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface SceneProps {
  apps: OrbApp[];
  state: OrbState;
  reduced: boolean;
  dark: boolean;
  accent: readonly [string, string];
  signals: React.RefObject<OrbSignals>;
}

export default function OrbScene({ apps, state, reduced, dark, accent, signals }: SceneProps) {
  const router = useRouter();
  // Same lattice OrbStage builds its app dots from (dotField).
  const normals = useMemo(() => fibonacciSphere(apps.length), [apps.length]);
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
    screen: new Float32Array(apps.length * 3).fill(-1),
    invalidate: () => {},
  });
  const box = useRef<HTMLDivElement>(null);
  const label = useRef<HTMLAnchorElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const links = useRef<Array<HTMLAnchorElement | null>>([]);
  const moved = useRef(0);
  const snapping = useRef(false);
  const tapRevealed = useRef(false);
  const [hot, setHot] = useState<number | null>(null);
  const [query, setQuery] = useState("");

  function hover(i: number | null, bringFront = false, holdMs = 0) {
    const sh = shared.current;
    sh.hovered = i;
    sh.holdMs = i === null ? 0 : holdMs;
    sh.lastInput = performance.now();
    sh.target = i !== null && bringFront ? frontRotationNear(normals[i], sh.rot.y, sh.rot.x) : null;
    sh.invalidate();
    setHot(i);
  }

  /** Wheel settle: bring app dot i front-centre, highlight it, pulse the dots. Enter opens it (its link takes focus). */
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
    const i = matchApp(apps.map((a) => a.label), q);
    hover(i >= 0 ? i : null, i >= 0);
  }

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
        // No momentum: step from app dot to app dot.
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
      // Wheel down rolls dots up over the front (like page content); horizontal turns about the vertical axis.
      sh.rot.vx = clamp(sh.rot.vx - dy * WHEEL_GAIN, -MAX_SPIN, MAX_SPIN);
      sh.rot.vy = clamp(sh.rot.vy - dx * WHEEL_GAIN, -MAX_SPIN, MAX_SPIN);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [normals, reduced]);

  /** App dot under the pointer, or -1. */
  function dotAt(e: { clientX: number; clientY: number; pointerType: string }): number {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return -1;
    const reach = e.pointerType === "mouse" ? REACH_PX : TOUCH_REACH_PX;
    return pickDot(shared.current.screen, e.clientX - rect.left, e.clientY - rect.top, reach);
  }

  function onPointerDown(e: React.PointerEvent) {
    const onChrome = (e.target as HTMLElement).closest("input, a");
    if (e.button !== 0 || (onChrome && onChrome.tagName === "INPUT")) return;
    const sh = shared.current;
    const r = sh.rot;
    // Touch has no hover: a tap reveals the dot's label, a second tap (on the label) opens it.
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

  /** Mouse hover: the dot under the pointer bulges. Dots sliding under a still pointer during a wheel spin do not count. */
  function onPointerMove(e: React.PointerEvent) {
    const sh = shared.current;
    if (e.pointerType !== "mouse" || sh.rot.dragging || sh.coasting) return;
    sh.lastInput = performance.now();
    // Over the label: it belongs to the hovered dot.
    if ((e.target as HTMLElement).closest("a")) return;
    const i = dotAt(e);
    if (i >= 0 ? i !== sh.hovered : sh.hovered !== null && sh.holdMs === 0 && !sh.target) hover(i >= 0 ? i : null);
  }

  const hotApp = hot !== null ? apps[hot] : undefined;
  const HotIcon = hotApp ? ORB_ICONS[hotApp.icon] : null;
  const hue = hotApp ? groupHue(hotApp.group) : "";

  return (
    <div
      ref={box}
      className={`relative isolate size-full touch-none select-none overflow-hidden [container:orb/size] ${hotApp ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}
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
      <div className="pointer-events-none absolute inset-0">
        <Canvas camera={{ position: [0, 0, CAMERA_Z], fov: FOV }} dpr={[1, 2]} frameloop={reduced ? "demand" : "always"} gl={{ antialias: true, alpha: true }}>
          <OrbStage count={apps.length} state={state} reduced={reduced} dark={dark} accent={accent} shared={shared} signals={signals} label={label} glow={glow} onSnap={snap} />
        </Canvas>
      </div>
      {/* Every app, for keyboard and screen readers: focus rotates the sphere to bring that dot front. */}
      <ul aria-label="Apps" className="sr-only">
        {apps.map((app, i) => (
          <li key={app.href}>
            <Link
              ref={(el) => { links.current[i] = el; }}
              href={app.href}
              onFocus={() => !snapping.current && hover(i, true)}
              onBlur={() => !snapping.current && shared.current.hovered === i && hover(null)}
            >
              {app.label} ({app.group})
            </Link>
          </li>
        ))}
      </ul>
      {hotApp && HotIcon && (
        // Positioned every frame by OrbStage; its round end sits on the dot, so clicking the dot opens the app.
        <Link
          ref={label}
          href={hotApp.href}
          tabIndex={-1}
          aria-hidden
          draggable={false}
          className="group/label absolute left-0 top-0 z-10 flex items-center opacity-0 outline-none will-change-transform data-[side=left]:flex-row-reverse"
        >
          <span className="size-10 shrink-0 rounded-full" />
          <span
            className="flex items-center gap-2 rounded-full border bg-card/95 py-1.5 pl-1.5 pr-3.5 shadow-[0_18px_44px_-18px_rgb(0_0_0/0.6)] backdrop-blur group-data-[side=left]/label:flex-row-reverse group-data-[side=left]/label:pl-3.5 group-data-[side=left]/label:pr-1.5"
            style={{ borderColor: `color-mix(in oklab, ${hue} 55%, var(--border))` }}
          >
            <span className="grid size-8 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${hue} ${dark ? 28 : 15}%, transparent)`, color: hue }}>
              <HotIcon className="size-4" />
            </span>
            <span className="flex flex-col leading-tight group-data-[side=left]/label:items-end">
              <span className="whitespace-nowrap text-sm font-semibold text-foreground">{hotApp.label}</span>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">{hotApp.group}</span>
            </span>
          </span>
        </Link>
      )}
      <label className="absolute left-3 top-3 z-20 flex h-9 w-44 cursor-text items-center gap-2 rounded-full border border-border bg-card/90 px-3 text-sm shadow-sm backdrop-blur focus-within:ring-2 focus-within:ring-ring sm:w-52 [@container_orb_(max-height:20rem)]:hidden">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="sr-only">Find an app</span>
        <input
          value={query}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hotApp) router.push(hotApp.href);
            if (e.key === "Escape") onSearch("");
          }}
          onBlur={() => query && hover(null)}
          placeholder="Find an app"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
      </label>
      <p aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-2 z-20 px-3 text-center text-xs text-muted-foreground [@container_orb_(max-height:20rem)]:sr-only">
        {hotApp ? (
          <>
            <span className="font-medium text-foreground">{hotApp.label}</span> · Enter or click to open
          </>
        ) : (
          `Each bright dot is an app · ${apps.length} here · scroll or drag to spin`
        )}
      </p>
    </div>
  );
}
