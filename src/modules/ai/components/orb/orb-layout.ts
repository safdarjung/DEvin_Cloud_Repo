// Pure maths for the App Orb (no three.js, no React) so it is unit-testable.
export type Vec3 = readonly [number, number, number];
export type OrbState = "idle" | "listening" | "typing" | "submitted" | "streaming" | "proposing" | "waiting" | "done" | "error";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** n unit vectors spread evenly over a sphere (Fibonacci lattice). */
export function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const a = GOLDEN_ANGLE * i;
    pts.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  return pts;
}

const MIC_GAIN = 4;

/** 0..1 loudness from an AnalyserNode's byte time-domain samples (128 = silence). */
export function micLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const b of samples) sum += ((b - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / samples.length) * MIC_GAIN);
}

/** `proposing`: a card is flying out of the orb · `done`: a card was just approved · `waiting`: cards wait for the person. */
export function orbState(s: {
  status: string; typing: boolean; error: boolean; listening?: boolean; proposing?: boolean; done?: boolean; waiting?: boolean;
}): OrbState {
  if (s.error) return "error";
  if (s.listening) return "listening";
  if (s.proposing) return "proposing";
  if (s.status === "streaming") return "streaming";
  if (s.status === "submitted") return "submitted";
  if (s.done) return "done";
  if (s.typing) return "typing";
  return s.waiting ? "waiting" : "idle";
}

export interface Wave {
  /** Surface noise amplitude (fraction of the radius). */
  amp: number;
  /** Noise animation speed. */
  speed: number;
  /** Strength of the "speaking" ripple travelling from the front pole. */
  ripple: number;
  /** Dot brightness. */
  glow: number;
  /** Auto-rotation multiplier. */
  spin: number;
  /** Thinking: dots pull inward... */
  contract: number;
  /** ...and twist around the axis. */
  swirl: number;
  /** Typing: a light jitter band sweeping the surface. */
  jitter: number;
}

const CALM = { ripple: 0, contract: 0, swirl: 0, jitter: 0 };
const WAVES: Record<OrbState, Wave> = {
  idle: { ...CALM, amp: 0.035, speed: 0.3, glow: 0.35, spin: 1 },
  listening: { ...CALM, amp: 0.03, speed: 0.6, glow: 0.6, spin: 0.4 },
  typing: { ...CALM, amp: 0.04, speed: 0.5, glow: 0.5, spin: 0.8, jitter: 1 },
  submitted: { ...CALM, amp: 0.05, speed: 1.4, glow: 0.95, spin: 3, contract: 1, swirl: 1 },
  streaming: { ...CALM, amp: 0.05, speed: 0.9, glow: 0.8, spin: 1.2, ripple: 1 },
  // Negative contract: the dots swell outward as a card leaves the orb.
  proposing: { ...CALM, amp: 0.06, speed: 1.1, glow: 1, spin: 2, ripple: 0.5, contract: -0.6 },
  waiting: { ...CALM, amp: 0.03, speed: 0.4, glow: 0.55, spin: 0.6 },
  done: { ...CALM, amp: 0.045, speed: 0.8, glow: 0.9, spin: 1.6 },
  error: { ...CALM, amp: 0.04, speed: 0.5, glow: 0.3, spin: 0.3 },
};

/** Error: dots scatter and regroup. 0 at t=0, peaks at 1 after 0.25 s, back near 0 within ~2 s. */
export function scatterEnvelope(t: number): number {
  const x = Math.max(0, t) / 0.25;
  return x * Math.exp(1 - x);
}

export const waveFor = (state: OrbState): Wave => WAVES[state];

/** Rotate a vector about Y by `ry`, then about X by `rx`. */
export function rotateYX(v: Vec3, ry: number, rx: number): Vec3 {
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = v[0] * cy + v[2] * sy;
  const z1 = -v[0] * sy + v[2] * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  return [x1, v[1] * cx - z1 * sx, v[1] * sx + z1 * cx];
}

// ── Physical orb (pointer and touch) ─────────────────────────────────────

/** Drag offset with resistance: follows the finger at first, never past `max` px. */
export function rubberBand(d: number, max = 28, k = 80): number {
  return Math.sign(d) * max * (1 - Math.exp(-Math.abs(d) / k));
}

const FLICK = { stepPx: 240, minPx: 36, minV: 450, coast: 0.18, maxSteps: 2 };

/**
 * Mode steps a horizontal drag/flick settles on: positive = next mode (drag or flick left), 0 = stay.
 * The spin coasts `coast` seconds at release speed `vx` (px/s) past the drag `dx` (px) and snaps to whole steps;
 * a deliberate drag or flick moves one step; only a hard flick (about 1,500 px/s and up) coasts on to a second.
 */
export function flickDelta(dx: number, vx: number): number {
  const projected = dx + vx * FLICK.coast;
  let steps = Math.round(projected / FLICK.stepPx);
  if (steps === 0 && (Math.abs(dx) >= FLICK.minPx || Math.abs(vx) >= FLICK.minV)) steps = Math.sign(projected || dx);
  return -Math.max(-FLICK.maxSteps, Math.min(FLICK.maxSteps, steps)) || 0;
}

/** Index after moving `delta` steps through `n` items, wrapping both ways. */
export const stepIndex = (i: number, delta: number, n: number): number => (n > 0 ? (((i + delta) % n) + n) % n : 0);

/** Shortest signed step count from index `a` to `b` on a ring of `n` (5 → 0 of 6 is +1). */
export function ringDelta(a: number, b: number, n: number): number {
  if (n <= 0) return 0;
  const d = (((b - a) % n) + n) % n;
  return d > n / 2 ? d - n : d;
}

/** Keystroke energy: each key adds a little and it decays in the frame loop, so faster typing holds a brighter orb. */
export const typingPulse = (pulse: number): number => Math.min(1.6, pulse + 0.35);
