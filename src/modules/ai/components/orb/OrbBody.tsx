"use client";

// The orb. Full size it is the page's hero: a sphere of living dust (OrbCore, whose
// motion follows the AI state) in front of a role-tinted glow and a faint orbit ring,
// with the current mode's sections (children: OrbGroups' buttons, `nodeKey` set)
// riding its surface. Drag or wheel spins them with inertia and a springy snap of the
// nearest one to the front; keyboard focus turns a section to the front; a slow idle
// spin pauses on hover, focus and an open section; hovering parts the neighbours and
// lights the dust behind. One frame loop (motion's, which OrbCore renders in too)
// spins the sphere and writes each section's transform and opacity straight to the
// DOM; it stops when the tab is hidden or the orb is off-screen. No WebGL or reduced
// motion: nothing spins and OrbGroups lays the sections flat on the front. Small (a
// conversation open), the orb leans toward the open section in the row below instead.
// Each state reads without colour (icon + text in the pill), a badge counts cards
// waiting, and phones get tiny haptics.
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { animate, cancelFrame, frame, motion, useMotionValue, useSpring, type FrameData } from "motion/react";
import { Check, FilePlus2, Inbox, Loader2, MessageSquareText, Mic, Sparkles, TriangleAlert } from "lucide-react";
import type { OrbSignals } from "./OrbCore";
import {
  coastDistance, easeOutBack, frontAngle, idleEase, nearestAngle, nodeLook, nodePoints, nudgeAway, ringIsFull, rotateYX, smoothstep, snapAngle, springStep,
  type OrbState, type Vec3,
} from "./orb-layout";
import { ORB_ERROR } from "./orb-theme";

const OrbCore = dynamic(() => import("./OrbCore"), { ssr: false });

export interface Lean {
  x: number;
  y: number;
  hue: string;
}

interface Props {
  state: OrbState;
  accent: readonly [string, string];
  dark: boolean;
  reduced: boolean;
  use3d: boolean;
  signals: React.RefObject<OrbSignals>;
  compact: boolean;
  /** Cards waiting for approval. */
  waiting: number;
  /** Lean toward an open group in the row (null: none). */
  lean: Lean | null;
  /** Bumps on every keystroke: a tiny nudge in every render path. */
  typingTick: number;
  orbRef: React.RefObject<HTMLDivElement | null>;
  /** Changes whenever the sections riding the sphere change (a mode switch); "" when none do. */
  nodeKey: string;
  /** Full size only: whether the sphere is big enough for tappable sections (OrbView shows the row otherwise). */
  onRoomy: (roomy: boolean) => void;
  /** A tap on the bare orb (no sections on it). */
  onTap: () => void;
  showStatus: boolean;
  /** The sections (OrbGroups, sphere layout). */
  children?: React.ReactNode;
}

const STATE_UI: Record<OrbState, { label: string; Icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }> = {
  idle: { label: "Ready", Icon: Sparkles },
  typing: { label: "Ready", Icon: Sparkles },
  listening: { label: "Listening", Icon: Mic },
  submitted: { label: "Thinking", Icon: Loader2 },
  streaming: { label: "Answering", Icon: MessageSquareText },
  proposing: { label: "Preparing a card", Icon: FilePlus2 },
  waiting: { label: "Waiting for you", Icon: Inbox },
  done: { label: "Done", Icon: Check },
  error: { label: "Something went wrong", Icon: TriangleAlert },
};

const POS = { stiffness: 220, damping: 9, mass: 0.8 }; // low damping: a wobble on release
const SQUASH = { stiffness: 520, damping: 14 };
const LEAN_PX = 8;
/** Movement (px) that turns a press into a drag: a drag never opens a section. */
const SLOP_PX = { mouse: 6, touch: 12 };
/** Released this long after the last move: no fling. */
const STALE_MS = 80;
/** Section radius as a share of the stage's side: the sphere's radius. */
const NODE_RADIUS = 0.37;
/** Below this diameter (px) sections could not be tapped reliably. */
const MIN_NODE_SPHERE_PX = 220;
const AUTO_SPIN = 0.12;
/** Idle sway (radians either way) for fewer sections than a full ring; it peaks at the AUTO_SPIN speed. */
const SWAY = 0.3;
/** Exponential friction on a free spin (1/s), and the speed (rad/s) below which it hands over to the snap. */
const FRICTION = 2.4;
const SNAP_SPEED = 0.9;
const WHEEL_QUIET_MS = 90;
/** Wheel px -> spin impulse (rad/s): one mouse notch coasts about one section. */
const WHEEL_GAIN = 0.016;
const MAX_SPIN = 9;
/** Each section's fly-in, after [delay, stagger per section] in seconds: longer on arrival while the dust assembles (under 1.2 s in all). */
const FLY_S = 0.45;
const ARRIVAL = [0.35, 0.05] as const;
const MODE_CHANGE = [0, 0.025] as const;
/** Hovered section: its neighbours turn away by up to this (radians). */
const PART = 0.16;
const PRESS_SCALE = 0.94;
/** Gap (px) kept between a chip and the clipped edge of the orb's column. */
const EDGE_PX = 6;

interface Spin {
  ry: number;
  vy: number;
  /** Angle the sphere springs to (snap, keyboard focus, a new mode); null: free. */
  target: number | null;
  dragging: boolean;
  /** A fling or wheel spin in flight: snap once it slows. */
  coasting: boolean;
  wheelAt: number;
  lastInput: number;
  hover: boolean;
  focus: boolean;
  /** Hovered or keyboard-focused section, and the pressed one (-1: none). */
  hot: number;
  press: number;
  pts: Vec3[];
}

/** Sound-free haptics: phones only, tiny durations, never under reduced motion. */
export function buzz(reduced: boolean, pattern: number | number[]) {
  if (reduced || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    if (window.matchMedia("(pointer: coarse)").matches) navigator.vibrate(pattern);
  } catch {
    /* vibration blocked: nothing to do */
  }
}

/** Half of a faint, tilted orbit ring round the sphere: the far half sits behind it, the near half in front. Role colour from the stage's CSS variables. */
function Orbit({ near }: { near: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute left-[-9%] top-[-9%] size-[118%] overflow-visible">
      <path
        d={`M 0 50 A 50 12 0 0 ${near ? 0 : 1} 100 50`}
        transform="rotate(-9 50 50)"
        fill="none"
        className="stroke-(--orb-a) dark:stroke-(--orb-b)"
        strokeOpacity={near ? 0.45 : 0.22}
        strokeWidth={near ? 1.25 : 1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const nodeOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>("[data-node]") : null);

export function OrbBody(p: Props) {
  const { state, accent, dark, reduced, use3d, signals, compact, waiting, lean, typingTick, orbRef, nodeKey, onRoomy } = p;
  const x = useSpring(0, POS);
  const y = useSpring(0, POS);
  const sx = useSpring(1, SQUASH);
  const sy = useSpring(1, SQUASH);
  const shake = useMotionValue(0);
  const stage = useRef<HTMLDivElement>(null);
  const size = useRef(0);
  /** Half the width of the orb's column (chips are clamped inside it), and a bump when chips must be measured again. */
  const half = useRef(0);
  const remeasure = useRef(0);
  const keyRef = useRef(nodeKey);
  const hover = useRef<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const spin = useRef<Spin>({
    ry: 0, vy: 0, target: null, dragging: false, coasting: false, wheelAt: -Infinity, lastInput: -Infinity,
    hover: false, focus: false, hot: -1, press: -1, pts: [],
  });
  const showCanvas = use3d && !reduced;

  useEffect(() => {
    keyRef.current = nodeKey;
  }, [nodeKey]);

  const rest = () => ({ x: hover.current?.x ?? lean?.x ?? 0, y: hover.current?.y ?? lean?.y ?? 0 });
  const settle = () => {
    const r = rest();
    x.set(reduced ? 0 : r.x);
    y.set(reduced ? 0 : r.y);
  };

  useEffect(() => {
    if (!spin.current.dragging) settle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settle reads refs; re-run only when the lean target changes
  }, [lean?.x, lean?.y, reduced]);

  // One-shot reactions to state changes: pop on done/proposing, shake on error.
  const prev = useRef(state);
  useEffect(() => {
    const was = prev.current;
    prev.current = state;
    if (was === state || reduced) return;
    if (state === "done" || state === "proposing") {
      sx.set(1.12);
      sy.set(1.12);
      const t = setTimeout(() => (sx.set(1), sy.set(1)), 140);
      buzz(reduced, state === "done" ? [8, 50, 12] : 10);
      return () => clearTimeout(t);
    }
    if (state === "error") {
      buzz(reduced, 20);
      const a = animate(shake, [0, -9, 9, -6, 6, -3, 0], { duration: 0.45 });
      return () => a.stop();
    }
  }, [state, reduced, sx, sy, shake]);

  useEffect(() => {
    if (!typingTick || reduced) return;
    sx.set(1.025);
    sy.set(0.985);
    const t = setTimeout(() => (sx.set(1), sy.set(1)), 60);
    return () => clearTimeout(t);
  }, [typingTick, reduced, sx, sy]);

  // Stage size for the projection, and whether a full-size sphere can hold tappable sections.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      size.current = el.offsetWidth;
      half.current = (el.parentElement?.offsetWidth ?? el.offsetWidth) / 2;
      remeasure.current++;
      if (!compact) onRoomy(2 * NODE_RADIUS * size.current >= MIN_NODE_SPHERE_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact, onRoomy]);

  // The frame loop: spin physics, the sections' transforms, and the spin + hot spot for the dust.
  useEffect(() => {
    const el = stage.current;
    if (!showCanvas || !el) return;
    const sp = spin.current;
    const sig = signals.current;
    const born = performance.now();
    let els: HTMLElement[] = [];
    let parts: Array<{ sheen: HTMLElement | null; front: HTMLElement | null }> = [];
    let widths: number[] = [];
    let measured = -1;
    let key: string | null = null;
    let fly: readonly [number, number] = ARRIVAL;
    let since = 0;
    let idle = 0;
    let rest: number | null = null;
    let swayT = 0;
    let hotK = 0;
    let hotI = -1;
    let hotP: Vec3 = [0, 0, 1];

    const step = ({ delta }: FrameData) => {
      const dt = Math.min(delta / 1000, 0.05);
      const now = performance.now();
      const fresh = key !== keyRef.current;
      if (fresh || (els.length > 0 && !els[0].isConnected)) {
        key = keyRef.current;
        els = [...el.querySelectorAll<HTMLElement>("[data-node]")];
        parts = els.map((n) => ({ sheen: n.querySelector<HTMLElement>("[data-sheen]"), front: n.querySelector<HTMLElement>("[data-front]") }));
        sp.pts = nodePoints(els.length);
        measured = -1;
        if (fresh) {
          // New sections (arrival or a mode change) fly out to their places while the sphere turns to face their middle.
          since = 0;
          fly = now - born < 500 ? ARRIVAL : MODE_CHANGE;
          sp.vy = 0;
          sp.coasting = false;
          sp.hot = sp.press = -1;
          sp.target = snapAngle(sp.pts, nearestAngle(sp.ry, 0));
        }
      }
      since += dt;
      // Chip widths (layout read) only when the chips or the stage change, never per frame.
      if (measured !== remeasure.current || widths.length !== els.length) {
        measured = remeasure.current;
        widths = els.map((n) => n.offsetWidth);
      }

      const open = els.findIndex((n) => n.getAttribute("aria-expanded") === "true");
      if (open >= 0) {
        // An open section holds the sphere still: its popover is anchored to it.
        if (sp.target !== null) sp.ry = sp.target;
        sp.target = null;
        sp.vy = 0;
        sp.coasting = false;
        sp.lastInput = now;
      } else if (sp.dragging) {
        // The pointer turns the sphere (onPointerDown).
      } else if (sp.target !== null) {
        const s = springStep(sp.ry, sp.vy, sp.target, dt);
        sp.ry = s.x;
        sp.vy = s.v;
        if (Math.abs(sp.target - sp.ry) < 1e-3 && Math.abs(sp.vy) < 1e-2) {
          sp.ry = sp.target;
          sp.vy = 0;
          sp.target = null;
          sp.lastInput = now;
        }
      } else {
        sp.ry += sp.vy * dt;
        sp.vy *= Math.exp(-dt * FRICTION);
        if (sp.coasting && now - sp.wheelAt > WHEEL_QUIET_MS && Math.abs(sp.vy) < SNAP_SPEED) {
          sp.coasting = false;
          sp.target = snapAngle(sp.pts, sp.ry + coastDistance(sp.vy, FRICTION));
          if (sp.target !== null) buzz(false, 6);
        }
      }
      // Idle motion eases in 2 s after the last input; never while hovered, focused, open, dragged, snapping or coasting.
      // A full ring spins; fewer sections sway round where they rest, so none drifts behind the sphere.
      const resting = els.length > 0 && open < 0 && !sp.hover && !sp.focus && !sp.dragging && !sp.coasting && sp.target === null;
      idle = resting ? idleEase((now - sp.lastInput) / 1000) : idle * Math.exp(-dt * 8);
      if (!resting) rest = null;
      else if (ringIsFull(els.length)) sp.ry += dt * AUTO_SPIN * idle;
      else {
        if (rest === null) {
          rest = sp.ry;
          swayT = 0;
        }
        swayT += dt;
        sp.ry = rest + SWAY * Math.sin((swayT * AUTO_SPIN) / SWAY) * idle;
      }
      sig.spin = sp.ry;

      // The hot section (open, else hovered or keyboard-focused): neighbours part and the dust behind it brightens.
      const hot = open >= 0 ? open : sp.dragging ? -1 : sp.hot;
      if (hot >= 0 && sp.pts[hot]) {
        hotI = hot;
        hotP = sp.pts[hot];
      }
      hotK += ((hot >= 0 ? 1 : 0) - hotK) * Math.min(1, dt * 10);
      const hv = rotateYX(hotP, sp.ry, 0);
      sig.hot[0] = hv[0];
      sig.hot[1] = hv[1];
      sig.hot[2] = hv[2];
      sig.hot[3] = hotK;

      const radius = NODE_RADIUS * size.current;
      els.forEach((n, i) => {
        const a = Math.min(1, Math.max(0, (since - fly[0] - i * fly[1]) / FLY_S));
        const g = easeOutBack(a);
        const v = rotateYX(i === hotI || hotK < 1e-3 ? sp.pts[i] : nudgeAway(sp.pts[i], hotP, PART * hotK), sp.ry, 0);
        const look = nodeLook(v[2]);
        const r = radius * (0.15 + 0.85 * g);
        const s = look.scale * (0.4 + 0.6 * g) * (i === sp.press ? PRESS_SCALE : 1);
        // Keep the whole chip inside the column (a phone's screen edge), squeezing toward the middle at the limb.
        const room = Math.max(0, half.current - (widths[i] * s) / 2 - EDGE_PX);
        const x = Math.max(-room, Math.min(room, v[0] * r));
        n.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(2)}px, ${(-v[1] * r).toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
        n.style.opacity = (look.opacity * Math.min(1, a * 2.5)).toFixed(3);
        n.style.pointerEvents = look.pickable && a > 0.6 ? "" : "none";
        // Back-hemisphere chips stack below the sphere (negative, inside the isolated stage), so its veil and dust pass over them.
        n.style.zIndex = String(Math.round(v[2] * 10) + (v[2] < 0 ? -11 : 11));
        // Light catches a section as it turns to the front; the one at the front gets its ring.
        const { sheen, front } = parts[i];
        if (sheen) sheen.style.opacity = smoothstep(0.2, 1, v[2]).toFixed(3);
        if (front) front.style.opacity = (smoothstep(0.94, 0.995, v[2]) * a).toFixed(3);
      });
    };

    let onScreen = true;
    let running = false;
    const sync = () => {
      const want = onScreen && !document.hidden;
      if (want && !running) frame.update(step, true);
      else if (!want && running) cancelFrame(step);
      running = want;
    };
    const io = new IntersectionObserver(([e]) => {
      onScreen = e?.isIntersecting ?? true;
      sync();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      cancelFrame(step);
      sig.hot[3] = 0;
      // Static layout from here on (reduced motion switched on): drop what the loop wrote.
      for (const n of els) for (const k of ["transform", "opacity", "pointer-events", "z-index"]) n.style.removeProperty(k);
    };
  }, [showCanvas, signals]);

  // Wheel and trackpad spin the sections round; the page must not scroll under them (non-passive listener).
  useEffect(() => {
    const el = stage.current;
    if (!showCanvas || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (!keyRef.current || el.querySelector('[data-node][aria-expanded="true"]')) return;
      e.preventDefault();
      const sp = spin.current;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      sp.target = null;
      sp.coasting = true;
      sp.hot = -1;
      sp.lastInput = sp.wheelAt = performance.now();
      // Wheel down (or right) brings the next section round, like scrolling a list.
      sp.vy = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, sp.vy - (e.deltaX + e.deltaY) * unit * WHEEL_GAIN));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [showCanvas]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const sp = spin.current;
    const node = nodeOf(e.target);
    const slop = e.pointerType === "mouse" ? SLOP_PX.mouse : SLOP_PX.touch;
    let moved = 0;
    dragged.current = false;
    buzz(reduced, 6);
    // A small squash on press: the pressed section, else the orb.
    if (node) sp.press = Number(node.dataset.node);
    else if (!reduced) {
      sx.set(1.03);
      sy.set(0.96);
    }
    if (showCanvas) {
      sp.dragging = true;
      sp.target = null;
      sp.coasting = false;
      sp.vy = 0;
      sp.hot = -1;
      sp.lastInput = performance.now();
    }
    let lx = e.clientX;
    let ly = e.clientY;
    let lt = performance.now();
    const move = (ev: PointerEvent) => {
      const t = performance.now();
      const dx = ev.clientX - lx;
      moved += Math.abs(dx) + Math.abs(ev.clientY - ly);
      if (moved > slop) sp.press = -1;
      if (sp.dragging) {
        // px -> radians so the front of the sphere follows the pointer.
        const k = 1 / Math.max(40, NODE_RADIUS * size.current);
        sp.ry += dx * k;
        sp.vy = 0.5 * sp.vy + (0.5 * dx * k) / (Math.max(8, t - lt) / 1000);
        sp.lastInput = t;
      }
      lx = ev.clientX;
      ly = ev.clientY;
      lt = t;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      dragged.current = moved > slop;
      sp.press = -1;
      sx.set(1);
      sy.set(1);
      if (sp.dragging) {
        sp.dragging = false;
        sp.lastInput = performance.now();
        if (performance.now() - lt > STALE_MS) sp.vy = 0;
        // Coast, then snap the nearest section to the front (at once when released still).
        sp.coasting = true;
      }
      if (ev.type === "pointerup" && !dragged.current && !node && !keyRef.current) p.onTap();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    // Mouse over the bare orb (no sections on it): it leans toward the pointer.
    if (e.pointerType !== "mouse" || reduced || keyRef.current || spin.current.dragging) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    hover.current = { x: Math.max(-1, Math.min(1, nx)) * LEAN_PX, y: Math.max(-1, Math.min(1, ny)) * LEAN_PX };
    settle();
  }

  function onFocus(e: React.FocusEvent) {
    const sp = spin.current;
    sp.focus = true;
    const node = nodeOf(e.target);
    const v = node ? sp.pts[Number(node.dataset.node)] : undefined;
    // Keyboard focus turns the section to the front; a click opens it where it is.
    if (!node || !v || !showCanvas || !node.matches(":focus-visible")) return;
    sp.hot = Number(node.dataset.node);
    sp.coasting = false;
    sp.lastInput = performance.now();
    sp.target = nearestAngle(sp.ry, frontAngle(v));
  }

  const ui = STATE_UI[state];
  const coreColor = state === "error" ? [ORB_ERROR, ORB_ERROR] : accent;
  const breathing = !reduced && (state === "idle" || state === "typing" || state === "waiting");
  // Theme-dependent colours go through CSS (dark:), not `dark`, so the server HTML matches on hydration.
  const roleVars = { "--orb-a": accent[0], "--orb-b": accent[1] } as React.CSSProperties;

  return (
    // Clip sideways: the glow, ring and edge chips must not widen a phone's layout viewport (it would zoom the page out).
    <div className="flex w-full flex-col items-center gap-2 overflow-x-clip">
      <div
        ref={stage}
        data-orb-stage
        onPointerDown={onPointerDown}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") spin.current.hover = true;
        }}
        onPointerOver={(e) => {
          if (e.pointerType !== "mouse" || spin.current.dragging) return;
          const node = nodeOf(e.target);
          spin.current.hot = node ? Number(node.dataset.node) : -1;
        }}
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          const sp = spin.current;
          sp.hover = false;
          if (!sp.focus) sp.hot = -1;
          hover.current = null;
          if (!sp.dragging) settle();
        }}
        onClickCapture={(e) => {
          // A drag that ends on a section must not open it (keyboard clicks have detail 0).
          if (dragged.current && e.detail > 0) {
            e.preventDefault();
            e.stopPropagation();
          }
          dragged.current = false;
        }}
        onFocus={onFocus}
        onBlur={(e) => {
          const sp = spin.current;
          sp.focus = e.currentTarget.contains(e.relatedTarget as Node | null);
          if (!sp.focus) sp.hot = -1;
        }}
        // Vertical swipes still scroll the page; horizontal drags spin the sphere.
        style={{ touchAction: "pan-y", ...roleVars }}
        className={`relative isolate select-none ${showCanvas ? "cursor-grab active:cursor-grabbing" : ""} ${compact ? "size-28 sm:size-32" : "size-[min(90vw,34rem,58dvh,calc(100dvh_-_30rem))]"}`}
      >
        {/* Depth: a soft role-tinted glow and the far half of an orbit ring behind the sphere. */}
        <div
          aria-hidden
          // On a phone the sphere fills the column: the glow must fade out before the clip edge.
          className="pointer-events-none absolute -inset-[24%] rounded-full opacity-60 max-sm:-inset-[2%] dark:opacity-100"
          style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--orb-a) 42%, transparent), transparent)" }}
        />
        <Orbit near={false} />
        {/* Contact shadow: the sphere sits on something. */}
        <div aria-hidden className="pointer-events-none absolute inset-x-[24%] bottom-[2%] h-[7%] rounded-[50%] bg-black/25 blur-xl dark:bg-black/70" />
        <motion.div className="absolute inset-0" style={{ x: shake }}>
          <motion.div ref={orbRef} aria-hidden data-orb style={{ x, y, scaleX: sx, scaleY: sy }} className="absolute inset-0">
            <motion.div
              className="absolute inset-0"
              animate={breathing ? { scale: [1, 1.035, 1] } : { scale: 1 }}
              transition={breathing ? { duration: 4.8, repeat: Infinity, ease: "easeInOut" } : { duration: 0.3 }}
            >
              {lean && !reduced && (
                <motion.span
                  className="absolute -inset-3 rounded-full blur-xl"
                  style={{ background: `radial-gradient(circle, ${lean.hue}, transparent 70%)` }}
                  initial={{ opacity: 0.2, scale: 0.9 }}
                  animate={{ opacity: [0.25, 0.6, 0.25], scale: [0.95, 1.08, 0.95] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              {waiting > 0 && !reduced && (
                <motion.span
                  className="absolute inset-[6%] rounded-full border-2"
                  style={{ borderColor: accent[1] }}
                  initial={{ opacity: 0.6, scale: 1 }}
                  animate={{ opacity: [0.55, 0], scale: [1, 1.3] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                />
              )}
              <div
                className="absolute inset-[12%] overflow-hidden rounded-full transition-[background] duration-500"
                style={{
                  background: `radial-gradient(circle at 35% 30%, ${coreColor[1]}, ${coreColor[0]} 70%)`,
                  opacity: showCanvas ? (dark ? 0.5 : 0.42) : 0.9,
                  boxShadow: `0 0 40px -8px ${coreColor[1]}`,
                }}
              >
                {!showCanvas && (
                  // No WebGL / reduced motion: a still highlight where the dust would move.
                  <span
                    className="absolute -inset-1/4 rounded-full"
                    style={{ background: "conic-gradient(from 0deg, transparent 0 55%, rgb(255 255 255 / 0.35) 70%, transparent 85%)" }}
                  />
                )}
              </div>
              {/* Volume: an off-centre highlight, a darker limb toward the terminator and a soft inner glow. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-[12%] rounded-full opacity-100 dark:opacity-75"
                style={{
                  background:
                    "radial-gradient(circle at 33% 27%, rgb(255 255 255 / 0.6), rgb(255 255 255 / 0) 32%), radial-gradient(circle at 40% 36%, transparent 46%, rgb(12 8 32 / 0.26) 84%, rgb(8 4 24 / 0.5) 100%)",
                  boxShadow: "inset 0 0 40px -6px color-mix(in oklab, var(--orb-b) 75%, transparent), inset -16px -22px 44px -12px rgb(0 0 0 / 0.3)",
                }}
              />
              {showCanvas && (
                <div className="absolute -inset-[6%]">
                  <OrbCore state={state} dark={dark} accent={accent} signals={signals} />
                </div>
              )}
              {state === "done" && (
                <motion.span
                  className="absolute inset-0 grid place-items-center"
                  initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 18 }}
                >
                  <span className="grid size-12 place-items-center rounded-full bg-background/90 text-foreground shadow-lg">
                    <Check className="size-6" strokeWidth={3} aria-hidden />
                  </span>
                </motion.span>
              )}
            </motion.div>
            {waiting > 0 && (
              <motion.span
                key={waiting}
                className="absolute right-[8%] top-[8%] grid min-w-6 place-items-center rounded-full bg-foreground px-1.5 text-xs font-semibold tabular-nums text-background shadow-md"
                initial={reduced ? false : { scale: 0.4 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 600, damping: 15 }}
              >
                {waiting}
              </motion.span>
            )}
          </motion.div>
        </motion.div>
        <Orbit near />
        {p.children}
      </div>
      {p.showStatus && (
        <p className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
          <ui.Icon
            className={`size-3.5 ${state === "error" ? "text-destructive" : ""} ${state === "submitted" && !reduced ? "animate-spin" : ""}`}
            aria-hidden
          />
          {ui.label}
          {state === "waiting" && waiting > 0 ? ` (${waiting})` : ""}
        </p>
      )}
    </div>
  );
}
