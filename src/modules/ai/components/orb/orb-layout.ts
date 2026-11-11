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

const SHOCK_SPEED = 3;
const SHOCK_FADE = 2.2;

/**
 * A ring of light crossing the sphere t seconds after a send, a mode change or an approval:
 * `front` is its angle from the front pole (radians, past π it has left by the back) and
 * `strength` fades from 1; nothing before t = 0.
 */
export function shockAt(t: number): { front: number; strength: number } {
  if (t < 0) return { front: 0, strength: 0 };
  return { front: t * SHOCK_SPEED, strength: Math.exp(-t * SHOCK_FADE) };
}

/** The point of the sphere's front under the pointer: x, y in the orb's own -1..1 square (y up), pulled onto the rim when outside it. */
export function pointerDir(x: number, y: number): Vec3 {
  const l = Math.hypot(x, y);
  if (l >= 1) return [x / l, y / l, 0];
  return [x, y, Math.sqrt(1 - l * l)];
}

/** Rotate a vector about Y by `ry`, then about X by `rx`. */
export function rotateYX(v: Vec3, ry: number, rx: number): Vec3 {
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = v[0] * cy + v[2] * sy;
  const z1 = -v[0] * sy + v[2] * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  return [x1, v[1] * cx - z1 * sx, v[1] * sx + z1 * cx];
}

// ── Sections on the sphere ───────────────────────────────────────────────

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Widest longitude step between neighbouring sections, so a few of them share the front. */
const MAX_NODE_GAP = (50 * Math.PI) / 180;
/** Latitude (y) of the rows above and below the equator that sections alternate between (wider with a third row on the equator, so rows stay a 52 px chip apart on a phone). */
const NODE_BAND = 0.34;
const NODE_BAND_3 = 0.46;

/**
 * n section positions (unit vectors) on a band round the equator, centred on the front (+z):
 * evenly round the sphere but never more than 50° apart, so 2–7 sections share the front.
 * Neighbours alternate above and below the equator (and through it too, past 8) so labels do not collide.
 */
export function nodePoints(n: number): Vec3[] {
  const gap = Math.min(TAU / Math.max(n, 1), MAX_NODE_GAP);
  const rows = n > 8 ? [NODE_BAND_3, 0, -NODE_BAND_3] : n > 1 ? [NODE_BAND, -NODE_BAND] : [0];
  return Array.from({ length: n }, (_, i): Vec3 => {
    const lon = (i - (n - 1) / 2) * gap;
    const y = rows[i % rows.length];
    const r = Math.sqrt(1 - y * y);
    return [Math.sin(lon) * r, y, Math.cos(lon) * r];
  });
}

/** Do n sections go all the way round (8 and up)? Then the idle motion can spin; fewer only sway, so they never drift behind. */
export const ringIsFull = (n: number): boolean => n > 0 && TAU / n <= MAX_NODE_GAP;

/** The turn about Y (as `rotateYX(v, ry, 0)` uses it) that brings v to the front (+z). */
export const frontAngle = (v: Vec3): number => Math.atan2(-v[0], v[2]);

/** The angle equal to `target` (mod 2π) nearest to `current`, so a spin never goes the long way round. */
export function nearestAngle(current: number, target: number): number {
  return target + TAU * Math.round((current - target) / TAU);
}

/** Index of the point nearest the viewer with the sphere turned by ry; -1 for none. */
export function frontIndex(points: readonly Vec3[], ry: number): number {
  let best = -1;
  let bz = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const z = rotateYX(points[i], ry, 0)[2];
    if (z > bz) {
      bz = z;
      best = i;
    }
  }
  return best;
}

/** The turn that brings the point nearest the front at `ry` exactly to the front, the short way round; null with no points. */
export function snapAngle(points: readonly Vec3[], ry: number): number | null {
  const i = frontIndex(points, ry);
  return i < 0 ? null : nearestAngle(ry, frontAngle(points[i]));
}

const SPRING_STIFFNESS = 60;
const SPRING_DAMPING = 9;

/** One semi-implicit Euler step of an under-damped spring (about 10% overshoot): the springy snap. */
export function springStep(x: number, v: number, target: number, dt: number): { x: number; v: number } {
  const nv = v + (SPRING_STIFFNESS * (target - x) - SPRING_DAMPING * v) * dt;
  return { x: x + nv * dt, v: nv };
}

/** How far a spin at velocity v still travels under exponential friction (v' = -friction * v). */
export const coastDistance = (v: number, friction: number): number => (v === 0 ? 0 : v / friction);

const IDLE_AFTER_S = 2;
const IDLE_RAMP_S = 1.5;

/** Share (0..1) of the idle spin, given seconds since the last drag/wheel/focus input. */
export function idleEase(sinceInput: number): number {
  return smoothstep(0, 1, (sinceInput - IDLE_AFTER_S) / IDLE_RAMP_S);
}

/** Sections at or behind this depth take no pointer events (scale ≥ 0.85 when pickable keeps a 52 px target ≥ 44 px). */
const PICK_Z = 0.25;

/** How a section at depth z (1 front, -1 back) looks: front large and opaque, sides fading (never below 0.6 while pickable, for text contrast), back small, dim and not pickable. */
export function nodeLook(z: number): { scale: number; opacity: number; pickable: boolean } {
  return { scale: 0.8 + 0.2 * z, opacity: 0.15 + 0.85 * smoothstep(-0.25, 0.7, z), pickable: z > PICK_Z };
}

/**
 * Neighbours part around a hovered section: p turns away from h along the sphere by up to
 * `amount` radians, most when close, not at all beyond ~78° (cos 0.2).
 */
export function nudgeAway(p: Vec3, h: Vec3, amount: number): Vec3 {
  const d = p[0] * h[0] + p[1] * h[1] + p[2] * h[2];
  const w = smoothstep(0.2, 1, d) * amount;
  if (w < 1e-6 || d > 0.9999) return p;
  // Unit tangent at p pointing away from h, then a turn along that great circle.
  const s = Math.sqrt(1 - d * d);
  const u: Vec3 = [(p[0] * d - h[0]) / s, (p[1] * d - h[1]) / s, (p[2] * d - h[2]) / s];
  const c = Math.cos(w);
  const sn = Math.sin(w);
  return [p[0] * c + u[0] * sn, p[1] * c + u[1] * sn, p[2] * c + u[2] * sn];
}

/** 0 → 1 with a small overshoot (the dust entrance in orb-shaders.ts uses the same curve). */
export function easeOutBack(a: number): number {
  const t = clamp(a, 0, 1) - 1;
  return 1 + 2.70158 * t * t * t + 1.70158 * t * t;
}

// ── Mode swipe ───────────────────────────────────────────────────────────

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

/** Keystroke energy: each key adds a little and it decays in the frame loop, so faster typing holds a brighter orb. */
export const typingPulse = (pulse: number): number => Math.min(1.6, pulse + 0.35);
