"use client";

// The physical orb. Springs make it lean toward the pointer, squash on press, follow
// a drag a little and wobble back on release; a horizontal flick spins it with
// inertia and settles on the next mode. Each state reads without colour (icon +
// text in the pill), a badge counts cards waiting, and phones get tiny haptics.
// Everything here is a shortcut: the mode tabs, number keys and buttons do the same.
// DOM motion is transform/opacity only and runs in motion's single frame loop.
import dynamic from "next/dynamic";
import { useEffect, useRef } from "react";
import { animate, motion, useMotionValue, useMotionValueEvent, useSpring, useTransform } from "motion/react";
import { Check, FilePlus2, Inbox, Loader2, MessageSquareText, Mic, Sparkles, TriangleAlert } from "lucide-react";
import type { OrbSignals } from "./OrbCore";
import { flickDelta, ringDelta, rubberBand, type OrbState } from "./orb-layout";
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
  /** Lean toward an open group (null: none). */
  lean: Lean | null;
  modeIndex: number;
  modeCount: number;
  /** Bumps on every keystroke: a tiny nudge in every render path. */
  typingTick: number;
  orbRef: React.RefObject<HTMLDivElement | null>;
  onFlick: (delta: number) => void;
  /** The orb's turn in radians (drag, flick, mode change), for the 3D dots. */
  onTurn: (radians: number) => void;
  onTap: () => void;
  showStatus: boolean;
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
const TURN = { stiffness: 70, damping: 14 };
const LEAN_PX = 8;
const TAP_PX = 6;
const STALE_MS = 80;
const TURN_RAD = (2 * Math.PI) / 6;

/** Sound-free haptics: phones only, tiny durations, never under reduced motion. */
export function buzz(reduced: boolean, pattern: number | number[]) {
  if (reduced || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    if (window.matchMedia("(pointer: coarse)").matches) navigator.vibrate(pattern);
  } catch {
    /* vibration blocked: nothing to do */
  }
}

interface Drag {
  x0: number;
  y0: number;
  lastX: number;
  lastT: number;
  vx: number;
  moved: boolean;
}

export function OrbBody(p: Props) {
  const { state, accent, dark, reduced, use3d, signals, compact, waiting, lean, modeIndex, modeCount, typingTick, orbRef } = p;
  const x = useSpring(0, POS);
  const y = useSpring(0, POS);
  const sx = useSpring(1, SQUASH);
  const sy = useSpring(1, SQUASH);
  const turn = useSpring(0, TURN);
  const shake = useMotionValue(0);
  const sheen = useTransform(turn, (v) => `${(v * 180) / Math.PI}deg`);
  const drag = useRef<Drag | null>(null);
  const base = useRef({ turn: 0, mode: modeIndex });
  const hover = useRef<{ x: number; y: number } | null>(null);

  useMotionValueEvent(turn, "change", p.onTurn);

  const rest = () => ({ x: hover.current?.x ?? lean?.x ?? 0, y: hover.current?.y ?? lean?.y ?? 0 });
  const settle = () => {
    const r = rest();
    x.set(reduced ? 0 : r.x);
    y.set(reduced ? 0 : r.y);
  };

  // Any mode change (tab, key, swipe or flick) turns the orb the short way round to it.
  useEffect(() => {
    const d = ringDelta(base.current.mode, modeIndex, modeCount);
    base.current = { mode: modeIndex, turn: base.current.turn - d * TURN_RAD };
    if (reduced) turn.jump(base.current.turn);
    else turn.set(base.current.turn);
  }, [modeIndex, modeCount, reduced, turn]);

  useEffect(() => {
    if (!drag.current) settle();
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

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastT: e.timeStamp, vx: 0, moved: false };
    if (!reduced) {
      sx.set(1.07);
      sy.set(0.9);
    }
    buzz(reduced, 6);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) {
      if (e.pointerType !== "mouse" || reduced) return;
      const r = e.currentTarget.getBoundingClientRect();
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      hover.current = { x: Math.max(-1, Math.min(1, nx)) * LEAN_PX, y: Math.max(-1, Math.min(1, ny)) * LEAN_PX };
      settle();
      return;
    }
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const dt = (e.timeStamp - d.lastT) / 1000;
    if (dt > 0) d.vx = 0.7 * ((e.clientX - d.lastX) / dt) + 0.3 * d.vx;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    if (Math.hypot(dx, dy) > TAP_PX) d.moved = true;
    if (reduced) return;
    x.set(rubberBand(dx));
    y.set(rubberBand(dy));
    turn.set(base.current.turn + dx * 0.012);
  }

  function release(e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const d = drag.current;
    drag.current = null;
    sx.set(1);
    sy.set(1);
    settle();
    if (!d) return;
    if (!d.moved && !cancelled) return p.onTap();
    const vx = e.timeStamp - d.lastT > STALE_MS ? 0 : d.vx;
    const delta = cancelled ? 0 : flickDelta(e.clientX - d.x0, vx);
    if (delta) {
      buzz(reduced, 10);
      p.onFlick(delta);
    } else turn.set(base.current.turn);
  }

  const ui = STATE_UI[state];
  const showCanvas = use3d && !reduced;
  const coreColor = state === "error" ? [ORB_ERROR, ORB_ERROR] : accent;
  const breathing = !reduced && (state === "idle" || state === "typing" || state === "waiting");

  return (
    <div className="flex flex-col items-center gap-2">
      <motion.div style={{ x: shake }}>
        <motion.div
          ref={orbRef}
          aria-hidden
          data-orb
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => release(e, false)}
          onPointerCancel={(e) => release(e, true)}
          onPointerLeave={() => {
            hover.current = null;
            if (!drag.current) settle();
          }}
          style={{ x, y, scaleX: sx, scaleY: sy, touchAction: "none" }}
          className={`relative cursor-grab select-none active:cursor-grabbing ${compact ? "size-28 sm:size-32" : "size-36 sm:size-44"}`}
        >
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
                opacity: showCanvas ? (dark ? 0.35 : 0.3) : 0.9,
                boxShadow: `0 0 40px -8px ${coreColor[1]}`,
              }}
            >
              {!showCanvas && (
                // No WebGL / reduced motion: a turning sheen shows the spin and the mode turns.
                <motion.span
                  className="absolute -inset-1/4 rounded-full"
                  style={{ rotate: sheen, background: "conic-gradient(from 0deg, transparent 0 55%, rgb(255 255 255 / 0.35) 70%, transparent 85%)" }}
                />
              )}
            </div>
            {showCanvas && (
              <div className="absolute -inset-[6%]">
                <OrbCore state={state} dark={dark} accent={accent}signals={signals} />
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
