"use client";

// The orb. Full size it is the page's hero: a glass ball in living dust (OrbCore,
// whose motion follows the AI state) in front of a role-tinted glow and a faint orbit
// ring, with the current mode's features riding its surface as dots (children:
// OrbDots, `nodeKey` set). Drag turns the sphere on two axes and a fling keeps it
// spinning; the wheel spins it; keyboard focus, a lit section and a search turn the
// right dots to the front; a slow idle spin pauses on hover and focus. The hot dot
// (hovered, focused or tapped) bulges, its neighbours part, the dust behind it lights
// and its label follows it. One frame loop (motion's, which OrbCore renders in too)
// does the physics and writes each dot's transform and opacity straight to the DOM; it
// stops when the tab is hidden or the orb is off-screen. No WebGL or reduced motion:
// no dots here (OrbView shows the sections as a row instead). Small (a conversation
// open), the orb leans toward the open section in the row below. Each state reads
// without colour (icon + text in the pill), a badge counts cards waiting, and phones
// get tiny haptics.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, cancelFrame, frame, motion, useMotionValue, useSpring, type FrameData } from "motion/react";
import { Check, FilePlus2, Inbox, Loader2, MessageSquareText, Mic, Sparkles, TriangleAlert } from "lucide-react";
import type { OrbSignals } from "./OrbCore";
import {
  dotLook, dotPoints, dotSize, easeOutBack, frontAngle, frontTilt, idleEase, nearestAngle, nudgeAway, rotateYX, springStep,
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
  /** Feature dots ride the sphere: they are placed and turned here, with or without WebGL. */
  dots?: boolean;
  signals: React.RefObject<OrbSignals>;
  compact: boolean;
  /** Cards waiting for approval. */
  waiting: number;
  /** Lean toward an open group in the row (null: none). */
  lean: Lean | null;
  /** Bumps on every keystroke: a tiny nudge in every render path. */
  typingTick: number;
  orbRef: React.RefObject<HTMLDivElement | null>;
  /** Changes whenever the dots riding the sphere change (a mode switch); "" when none do. */
  nodeKey: string;
  /** Full size only: whether the sphere is big enough for tappable dots (OrbView shows the row otherwise). */
  onRoomy: (roomy: boolean) => void;
  /** A tap on the bare orb (no dots on it). */
  onTap: () => void;
  /** The mouse over the orb, in the ball's own -1..1 square (y up); `over` false when it leaves (x, y are then ignored). */
  onPointer: (x: number, y: number, over: boolean) => void;
  showStatus: boolean;
  /** The dots (OrbDots). */
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
/** Movement (px) that turns a press into a drag: a drag never runs a dot. */
const SLOP_PX = { mouse: 6, touch: 12 };
/** Released this long after the last move: no fling. */
const STALE_MS = 80;
/** The dots' sphere: its radius as a share of the stage's side (they ride the glass ball's surface). */
const NODE_RADIUS = 0.385;
/** The glass ball's radius as a share of half the stage (OrbCore draws it; the fallback disc has the same inset). */
const BALL_SHARE = 0.76;
/** Below this diameter (px) the dots could not be tapped reliably. */
const MIN_NODE_SPHERE_PX = 220;
const AUTO_SPIN = 0.12;
/** Idle sway (radians either way) for a few dots on the front; it peaks at the AUTO_SPIN speed. */
/** Exponential friction on a free spin (1/s), and the speed (rad/s) under which a fling counts as over. */
const FRICTION = 1.9;
const STILL = 0.05;
/** The sphere tilts this far either way (radians): the poles come to the front, never past it. */
const MAX_TILT = 1.15;
/** An angle kept in (-π, π] so a free tilt never grows without bound. */
const wrapAngle = (a: number): number => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
/** Tilt it rests at after a mode change: a little of the top shows. */
const REST_TILT = 0.22;
/** Wheel px -> spin impulse (rad/s). */
const WHEEL_GAIN = 0.016;
const MAX_SPIN = 9;
/** Each dot's fly-in, after [delay, time over which all of them start] in seconds: later on arrival while the dust assembles. */
const FLY_S = 0.45;
const ARRIVAL = [0.35, 0.7] as const;
const MODE_CHANGE = [0, 0.45] as const;
/** The hot dot: its neighbours turn away by up to this (radians), it grows by this share and lifts off the ball by this share of the radius. */
const PART = 0.14;
const BULGE = 0.42;
const LIFT = 0.07;
const PRESS_SCALE = 0.9;
/** Gap (px) kept between a dot and the clipped edge of the orb's column, and between the hot dot and its label. */
const EDGE_PX = 6;
const LABEL_GAP_PX = 10;
/** Half the label's widest size (px): it is kept inside the column. */
const LABEL_HALF_PX = 124;

interface Spin {
  /** Turn about the vertical axis and tilt about the horizontal one (radians), and their speeds. */
  ry: number;
  rx: number;
  vy: number;
  vx: number;
  /** Where the sphere springs to (keyboard focus, a lit section, a new mode); null: free. */
  target: { ry: number; rx: number } | null;
  dragging: boolean;
  /** A fling or wheel spin in flight. */
  coasting: boolean;
  lastInput: number;
  hover: boolean;
  focus: boolean;
  /** The pressed dot (-1: none). */
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

const ORBIT_S = 16;
/** The whole ring, far half first: the satellite's track. */
const ORBIT_TRACK = "M 0 50 A 50 12 0 0 1 100 50 A 50 12 0 0 1 0 50";

/**
 * Half of a faint, tilted orbit ring round the sphere: the far half sits behind it, the near half in front.
 * `moving`: a small satellite rides the ring, drawn by whichever half it is on. Role colour from the stage's CSS variables.
 */
function Orbit({ near, moving }: { near: boolean; moving: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 100 100" className="pointer-events-none absolute left-[-9%] top-[-9%] size-[118%] overflow-visible">
      <g transform="rotate(-9 50 50)">
        <path
          d={`M 0 50 A 50 12 0 0 ${near ? 0 : 1} 100 50`}
          fill="none"
          className="stroke-(--orb-a) dark:stroke-(--orb-b)"
          strokeOpacity={near ? 0.45 : 0.22}
          strokeWidth={near ? 1.25 : 1}
          vectorEffect="non-scaling-stroke"
        />
        {moving && (
          <circle r={near ? 1.1 : 0.8} className="fill-(--orb-a) dark:fill-(--orb-b)" style={{ filter: "drop-shadow(0 0 3px var(--orb-b))" }}>
            <animateMotion dur={`${ORBIT_S}s`} repeatCount="indefinite" path={ORBIT_TRACK} />
            <animate attributeName="opacity" dur={`${ORBIT_S}s`} repeatCount="indefinite" calcMode="discrete" values={near ? "0;1" : "0.7;0"} keyTimes="0;0.5" />
          </circle>
        )}
      </g>
    </svg>
  );
}

/** Whole seconds since it mounted: how long the orb has been thinking and answering. */
function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return s >= 3 ? <span className="tabular-nums text-muted-foreground"> · {s}s</span> : null;
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
    ry: 0, rx: REST_TILT, vy: 0, vx: 0, target: null, dragging: false, coasting: false, lastInput: -Infinity,
    hover: false, focus: false, press: -1, pts: [],
  });
  const showCanvas = use3d && !reduced;
  // The dots are plain elements: they show and turn without WebGL and under reduced motion (only the
  // automatic movement stops). Dots used to need both, so many phones and browsers showed none.
  const live = showCanvas || Boolean(p.dots);

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

  // The frame loop: spin physics on two axes, the dots' transforms, the hot dot's label, and the spin + hot spot for the dust.
  useEffect(() => {
    const el = stage.current;
    if (!live || !el) return;
    const sp = spin.current;
    const sig = signals.current;
    const born = performance.now();
    let els: HTMLElement[] = [];
    let dots: HTMLElement | null = null;
    let label: HTMLElement | null = null;
    let width = 0;
    let measured = -1;
    let key: string | null = null;
    let fly: readonly [number, number] = ARRIVAL;
    let since = 0;
    let idle = 0;
    let lit = "";
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
        dots = el.querySelector<HTMLElement>("[data-dots]");
        label = el.querySelector<HTMLElement>("[data-orb-label]");
        sp.pts = dotPoints(els.length);
        measured = -1;
        if (fresh) {
          // New dots (arrival or a mode change) fly out to their places while the sphere turns back to its resting pose.
          since = 0;
          fly = reduced ? [0, 0] : now - born < 500 ? ARRIVAL : MODE_CHANGE;
          sp.vy = sp.vx = 0;
          sp.coasting = false;
          sp.press = -1;
          sp.target = { ry: nearestAngle(sp.ry, 0), rx: nearestAngle(sp.rx, REST_TILT) };
          hotI = -1;
          lit = "";
        }
      }
      since += dt;
      // The dot size (a CSS variable all dots share) only when the dots or the stage change, never per frame.
      if (measured !== remeasure.current) {
        measured = remeasure.current;
        width = dotSize(NODE_RADIUS * size.current, els.length);
        el.style.setProperty("--dot", `${width}px`);
      }

      // A section or a search was lit (OrbDots dims the rest): the sphere turns the lit dots' middle to the front.
      const litNow = dots?.dataset.lit ?? "";
      if (litNow !== lit) {
        lit = litNow;
        const c = [0, 0, 0];
        els.forEach((n, i) => {
          if (lit && n.dataset.dim === undefined && sp.pts[i]) for (let k = 0; k < 3; k++) c[k] += sp.pts[i][k];
        });
        const len = Math.hypot(c[0], c[1], c[2]);
        if (len > 1e-3 && !sp.dragging) {
          const v: Vec3 = [c[0] / len, c[1] / len, c[2] / len];
          // A ring of dots round the axis has its middle on the axis: only the tilt says anything then.
          const ry = Math.hypot(v[0], v[2]) > 0.2 ? nearestAngle(sp.ry, frontAngle(v)) : sp.ry;
          sp.target = { ry, rx: nearestAngle(sp.rx, Math.max(-MAX_TILT, Math.min(MAX_TILT, frontTilt(v)))) };
          sp.coasting = false;
        }
      }

      if (sp.dragging) {
        // The pointer turns the sphere (onPointerDown).
      } else if (sp.target && reduced) {
        // Reduced motion: no glide, the sphere is simply at its new pose.
        sp.ry = sp.target.ry;
        sp.rx = sp.target.rx;
        sp.vy = sp.vx = 0;
        sp.target = null;
      } else if (sp.target) {
        const a = springStep(sp.ry, sp.vy, sp.target.ry, dt);
        const b = springStep(sp.rx, sp.vx, sp.target.rx, dt);
        sp.ry = a.x;
        sp.vy = a.v;
        sp.rx = b.x;
        sp.vx = b.v;
        if (Math.abs(sp.target.ry - sp.ry) < 1e-3 && Math.abs(sp.vy) < 1e-2 && Math.abs(sp.target.rx - sp.rx) < 1e-3 && Math.abs(sp.vx) < 1e-2) {
          sp.ry = sp.target.ry;
          sp.rx = sp.target.rx;
          sp.vy = sp.vx = 0;
          sp.target = null;
          sp.lastInput = now;
        }
      } else {
        sp.ry += sp.vy * dt;
        sp.rx = wrapAngle(sp.rx + sp.vx * dt);
        const f = Math.exp(-dt * FRICTION);
        sp.vy *= f;
        sp.vx *= f;
        if (sp.coasting && Math.abs(sp.vy) < STILL && Math.abs(sp.vx) < STILL) {
          sp.coasting = false;
          sp.lastInput = now;
        }
      }
      // A hard spin stirs the dust.
      sig.pulse = Math.max(sig.pulse, Math.min(1.2, (Math.abs(sp.vy) + Math.abs(sp.vx)) * 0.14));

      // The hot dot (OrbDots marks the hovered, focused or tapped one); none while the sphere is dragged.
      const hot = sp.dragging ? -1 : els.findIndex((n) => n.dataset.hot !== undefined);
      // Idle motion eases in 2 s after the last input; never while hovered, focused, dragged, turning or coasting.
      const resting = els.length > 0 && hot < 0 && !sp.hover && !sp.focus && !sp.dragging && !sp.coasting && sp.target === null;
      idle = resting ? idleEase((now - sp.lastInput) / 1000) : idle * Math.exp(-dt * 8);
      // Every orb spins slowly when left alone: its dots cover the whole sphere, so the back comes round.
      if (resting && !reduced) sp.ry += dt * AUTO_SPIN * idle;
      sig.spin = sp.ry;
      sig.tilt = sp.rx;

      // Its neighbours part and the dust behind it brightens.
      if (hot >= 0 && sp.pts[hot]) {
        hotI = hot;
        hotP = sp.pts[hot];
      }
      hotK += ((hot >= 0 ? 1 : 0) - hotK) * Math.min(1, dt * 10);
      const hv = rotateYX(hotP, sp.ry, sp.rx);
      sig.hot[0] = hv[0];
      sig.hot[1] = hv[1];
      sig.hot[2] = hv[2];
      sig.hot[3] = hotK;

      const radius = NODE_RADIUS * size.current;
      const stagger = fly[1] / Math.max(1, els.length);
      let hx = 0;
      let hy = 0;
      let hs = 1;
      els.forEach((n, i) => {
        const a = Math.min(1, Math.max(0, (since - fly[0] - i * stagger) / FLY_S));
        const g = easeOutBack(a);
        const k = i === hotI ? hotK : 0;
        const v = rotateYX(i === hotI || hotK < 1e-3 ? sp.pts[i] : nudgeAway(sp.pts[i], hotP, PART * hotK), sp.ry, sp.rx);
        const look = dotLook(v[2]);
        const r = radius * (0.15 + 0.85 * g) * (1 + LIFT * k);
        const s = look.scale * (0.4 + 0.6 * g) * (1 + BULGE * k) * (i === sp.press ? PRESS_SCALE : 1);
        // Keep the whole dot inside the column (a phone's screen edge).
        const room = Math.max(0, half.current - (width * s) / 2 - EDGE_PX);
        const x = Math.max(-room, Math.min(room, v[0] * r));
        const y = -v[1] * r;
        n.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${s.toFixed(4)})`;
        n.style.opacity = (Math.max(look.opacity, k) * Math.min(1, a * 2.5)).toFixed(3);
        n.style.pointerEvents = look.pickable && a > 0.6 ? "" : "none";
        // Back-hemisphere dots stack below the ball (negative, inside the isolated stage), so the glass and dust pass over them; the hot one is on top.
        n.style.zIndex = k > 0.5 ? "40" : String(Math.round(v[2] * 10) + (v[2] < 0 ? -11 : 11));
        if (i === hotI) {
          hx = x;
          hy = y;
          hs = s;
        }
      });
      if (label) {
        // Under the hot dot, or over it when the dot is low on the ball.
        const under = hy < radius * 0.3;
        const off = (width * hs) / 2 + LABEL_GAP_PX;
        const lx = Math.max(-(half.current - LABEL_HALF_PX), Math.min(half.current - LABEL_HALF_PX, hx));
        label.style.transform = `translate(-50%, ${under ? "0" : "-100%"}) translate3d(${lx.toFixed(1)}px, ${(hy + (under ? off : -off)).toFixed(1)}px, 0)`;
        label.style.opacity = hotK.toFixed(3);
      }
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
    };
  }, [live, reduced, signals]);

  // Wheel and trackpad spin the sphere; the page must not scroll under it (non-passive listener).
  useEffect(() => {
    const el = stage.current;
    if (!live || !el) return;
    const onWheel = (e: WheelEvent) => {
      if (!keyRef.current) return;
      e.preventDefault();
      const sp = spin.current;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      sp.target = null;
      sp.coasting = true;
      sp.lastInput = performance.now();
      // Wheel down (or right) brings the next dots round, like scrolling a list.
      sp.vy = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, sp.vy - (e.deltaX + e.deltaY) * unit * WHEEL_GAIN));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [live]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const sp = spin.current;
    const node = nodeOf(e.target);
    const slop = e.pointerType === "mouse" ? SLOP_PX.mouse : SLOP_PX.touch;
    let moved = 0;
    dragged.current = false;
    buzz(reduced, 6);
    // A small squash on press: the pressed dot, else the orb.
    if (node) sp.press = Number(node.dataset.node);
    else if (!reduced) {
      sx.set(1.03);
      sy.set(0.96);
    }
    if (live) {
      sp.dragging = true;
      sp.target = null;
      sp.coasting = false;
      sp.vy = sp.vx = 0;
      sp.lastInput = performance.now();
    }
    let lx = e.clientX;
    let ly = e.clientY;
    let lt = performance.now();
    const move = (ev: PointerEvent) => {
      const t = performance.now();
      const dx = ev.clientX - lx;
      const dy = ev.clientY - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      if (moved > slop) sp.press = -1;
      if (sp.dragging) {
        // px -> radians so the front of the sphere follows the pointer, on both axes.
        const k = 1 / Math.max(40, NODE_RADIUS * size.current);
        const span = Math.max(8, t - lt) / 1000;
        // Free on both axes: past the pole the sphere is upside down, so a sideways drag turns it the other way.
        const flip = Math.cos(sp.rx) < 0 ? -1 : 1;
        sp.ry += dx * k * flip;
        sp.rx = wrapAngle(sp.rx + dy * k);
        sp.vy = 0.5 * sp.vy + (0.5 * dx * k * flip) / span;
        sp.vx = 0.5 * sp.vx + (0.5 * dy * k) / span;
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
    if (e.pointerType !== "mouse" || reduced) return;
    const r = e.currentTarget.getBoundingClientRect();
    const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    // The ball's highlight and the dust under the pointer follow it (in the ball's own square, y up).
    p.onPointer(nx / BALL_SHARE, -ny / BALL_SHARE, true);
    // Mouse over the bare orb (no dots on it): it leans toward the pointer.
    if (keyRef.current || spin.current.dragging) return;
    hover.current = { x: Math.max(-1, Math.min(1, nx)) * LEAN_PX, y: Math.max(-1, Math.min(1, ny)) * LEAN_PX };
    settle();
  }

  function onFocus(e: React.FocusEvent) {
    const sp = spin.current;
    sp.focus = true;
    const node = nodeOf(e.target);
    const v = node ? sp.pts[Number(node.dataset.node)] : undefined;
    // Keyboard focus turns the dot to the front; a click runs it where it is.
    if (!node || !v || !live || !node.matches(":focus-visible")) return;
    sp.coasting = false;
    sp.lastInput = performance.now();
    sp.target = { ry: nearestAngle(sp.ry, frontAngle(v)), rx: nearestAngle(sp.rx, Math.max(-MAX_TILT, Math.min(MAX_TILT, frontTilt(v)))) };
  }

  const ui = STATE_UI[state];
  const coreColor = state === "error" ? [ORB_ERROR, ORB_ERROR] : accent;
  const breathing = !reduced && (state === "idle" || state === "typing" || state === "waiting");
  const working = state === "submitted" || state === "streaming";
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
        onPointerMove={onPointerMove}
        onPointerLeave={() => {
          const sp = spin.current;
          sp.hover = false;
          p.onPointer(0, 0, false);
          hover.current = null;
          if (!sp.dragging) settle();
        }}
        onClickCapture={(e) => {
          // A drag that ends on a dot must not run it (keyboard clicks have detail 0).
          if (dragged.current && e.detail > 0) {
            e.preventDefault();
            e.stopPropagation();
          }
          dragged.current = false;
        }}
        onFocus={onFocus}
        onBlur={(e) => {
          spin.current.focus = e.currentTarget.contains(e.relatedTarget as Node | null);
        }}
        // Vertical swipes still scroll the page; horizontal drags spin the sphere.
        style={{ touchAction: live && !compact ? "none" : "pan-y", ...roleVars }}
        className={`relative isolate select-none ${live ? "cursor-grab active:cursor-grabbing" : ""} ${compact ? "size-28 sm:size-32" : "size-[max(min(90vw,19rem),min(90vw,34rem,58dvh,calc(100dvh_-_30rem)))]"}`}
      >
        {/* Depth: a soft role-tinted glow and the far half of an orbit ring behind the sphere. */}
        <div
          aria-hidden
          // On a phone the sphere fills the column: the glow must fade out before the clip edge.
          className="pointer-events-none absolute -inset-[24%] rounded-full opacity-60 max-sm:-inset-[2%] dark:opacity-100"
          style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--orb-a) 42%, transparent), transparent)" }}
        />
        {/* A faint field of dots behind everything, fading out before the stage's edge. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-[16%] text-(--orb-a) opacity-25 max-sm:-inset-[2%] dark:text-(--orb-b) dark:opacity-20"
          style={{
            backgroundImage: "radial-gradient(currentColor 1px, transparent 1.5px)",
            backgroundSize: "22px 22px",
            maskImage: "radial-gradient(closest-side, black 40%, transparent 100%)",
          }}
        />
        {/* The glow swells while the orb listens, thinks and answers. */}
        {!reduced && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute -inset-[10%] rounded-full max-sm:-inset-[2%]"
            style={{ background: "radial-gradient(closest-side, color-mix(in oklab, var(--orb-b) 46%, transparent), transparent)" }}
            initial={false}
            animate={working || state === "listening" || state === "proposing" ? { opacity: [0.35, 0.9, 0.35], scale: [0.96, 1.04, 0.96] } : { opacity: 0, scale: 1 }}
            transition={working || state === "listening" || state === "proposing" ? { duration: state === "submitted" ? 1.3 : 2.2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.4 }}
          />
        )}
        <Orbit near={false} moving={!reduced} />
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
                  // With WebGL the glass ball is drawn by OrbCore: this disc only lends its glow.
                  opacity: showCanvas ? 0 : 0.9,
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
              {/* Volume: an off-centre highlight, a darker limb toward the terminator and a soft inner glow (the glass shader does this itself). */}
              {!showCanvas && <div
                aria-hidden
                className="pointer-events-none absolute inset-[12%] rounded-full opacity-100 dark:opacity-75"
                style={{
                  background:
                    "radial-gradient(circle at 33% 27%, rgb(255 255 255 / 0.6), rgb(255 255 255 / 0) 32%), radial-gradient(circle at 40% 36%, transparent 46%, rgb(12 8 32 / 0.26) 84%, rgb(8 4 24 / 0.5) 100%)",
                  boxShadow: "inset 0 0 40px -6px color-mix(in oklab, var(--orb-b) 75%, transparent), inset -16px -22px 44px -12px rgb(0 0 0 / 0.3)",
                }}
              />}
              {showCanvas && (
                // Wider than the stage (room for the motes), so it takes no pointer events: the tabs under the orb stay clickable.
                <div className="pointer-events-none absolute -inset-[20%]">
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
        <Orbit near moving={!reduced} />
        <AnimatePresence>
          {state === "submitted" && !reduced && (
            // Thinking: an arc of light runs round the ball.
            <motion.div key="arc" aria-hidden className="pointer-events-none absolute inset-[7%] text-(--orb-a) dark:text-(--orb-b)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <motion.div
                className="size-full rounded-full"
                style={{
                  background: "conic-gradient(from 0deg, transparent 0 50%, currentColor 97%, transparent)",
                  maskImage: "radial-gradient(closest-side, transparent calc(100% - 4.5px), black calc(100% - 4px))",
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 1.15, repeat: Infinity, ease: "linear" }}
              />
            </motion.div>
          )}
          {state === "listening" && !reduced &&
            [0, 0.9].map((delay) => (
              // Listening: rings travel outward like sound.
              <motion.span
                key={`sonar${delay}`}
                aria-hidden
                className="pointer-events-none absolute inset-[10%] rounded-full border border-(--orb-a) dark:border-(--orb-b)"
                initial={{ opacity: 0, scale: 1 }}
                animate={{ opacity: [0.7, 0], scale: [1, 1.38] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.8, delay, repeat: Infinity, ease: "easeOut" }}
              />
            ))}
        </AnimatePresence>
        {p.children}
      </div>
      {p.showStatus && (
        <p className="flex items-center gap-1.5 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-medium shadow-xs backdrop-blur" style={roleVars}>
          <span className="relative grid size-2 place-items-center" aria-hidden>
            {(working || state === "listening") && !reduced && <span className="absolute inset-0 animate-ping rounded-full bg-(--orb-a) dark:bg-(--orb-b)" />}
            <span className={`relative size-2 rounded-full ${state === "error" ? "bg-destructive" : "bg-(--orb-a) dark:bg-(--orb-b)"}`} />
          </span>
          {/* Keyed by its text: a new state slides in. */}
          <motion.span
            key={ui.label}
            className="flex items-center gap-1.5"
            initial={reduced ? false : { opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ui.Icon
              className={`size-3.5 ${state === "error" ? "text-destructive" : ""} ${state === "submitted" && !reduced ? "animate-spin" : ""}`}
              aria-hidden
            />
            {ui.label}
            {state === "waiting" && waiting > 0 ? ` (${waiting})` : ""}
          </motion.span>
          {working && <Elapsed />}
        </p>
      )}
    </div>
  );
}
