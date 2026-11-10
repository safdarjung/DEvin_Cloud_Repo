// Pure maths for the App Orb (no three.js, no React) so it is unit-testable.
export type Vec3 = readonly [number, number, number];
export type OrbState = "idle" | "listening" | "typing" | "submitted" | "streaming" | "error";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

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

const CLEARING_RAD = 0.1;

/**
 * The dot sphere: one well-separated dot per app (its own Fibonacci lattice) among ~nFiller
 * small filler dots that only give the sphere its form. Fillers inside an app dot's clearing
 * are dropped so the app dot reads on its own.
 */
export function dotField(nApps: number, nFiller: number): { apps: Vec3[]; filler: Vec3[] } {
  const apps = fibonacciSphere(nApps);
  const near = Math.cos(CLEARING_RAD);
  const filler = fibonacciSphere(nFiller).filter((f) => apps.every((a) => dot(a, f) < near));
  return { apps, filler };
}

/**
 * Which of the nApps + nFeatures lattice slots hold an AI feature (true) rather than an app:
 * features are interleaved evenly along the lattice, so they spread over the whole sphere.
 */
export function featureSlots(nApps: number, nFeatures: number): boolean[] {
  const n = nApps + nFeatures;
  return Array.from({ length: n }, (_, i) => Math.floor(((i + 0.5) * nFeatures) / n + 0.5) > Math.floor(((i - 0.5) * nFeatures) / n + 0.5));
}

const MIN_ICON_PX = 30;
/** A tiny sphere (phone with the transcript open) is for looking, not tapping. */
const TINY_RADIUS_PX = 100;
const TINY_MIN_ICON_PX = 16;
const MAX_ICON_PX = 68;

/** Front icon diameter in px for n icons on a sphere of `radius` px: a share of the gap between neighbours. */
export function iconSize(n: number, radius: number): number {
  const gap = radius * Math.sqrt((4 * Math.PI) / Math.max(n, 1));
  return clamp(gap * 0.42, radius < TINY_RADIUS_PX ? TINY_MIN_ICON_PX : MIN_ICON_PX, MAX_ICON_PX);
}

/**
 * Neighbours part around a bulging icon: p slides away from h along the sphere by up to
 * `amount`, most when closest. Mirrors `part()` in orb-shaders.ts (same 0.5..1 cosine window).
 */
export function nudgeAway(p: Vec3, h: Vec3, amount: number): Vec3 {
  const d = dot(p, h);
  const x = clamp((d - 0.5) / 0.5, 0, 1);
  const w = x * x * (3 - 2 * x) * amount;
  if (w < 1e-6 || d > 0.9999) return p;
  const t: Vec3 = [p[0] - h[0] * d, p[1] - h[1] * d, p[2] - h[2] * d];
  const tl = Math.hypot(t[0], t[1], t[2]) || 1;
  const q: Vec3 = [p[0] + (t[0] / tl) * w, p[1] + (t[1] / tl) * w, p[2] + (t[2] / tl) * w];
  const ql = Math.hypot(q[0], q[1], q[2]);
  return [q[0] / ql, q[1] / ql, q[2] / ql];
}

/** Dots at or behind this depth take no pointer events. */
const PICK_MIN_Z = 0.1;

/** Index of the front-hemisphere dot nearest to (x, y) within `reach` px; `screen` is [x, y, z] per dot. -1 if none. */
export function pickDot(screen: ArrayLike<number>, x: number, y: number, reach: number): number {
  let best = -1;
  let bd = reach;
  for (let i = 0; i * 3 < screen.length; i++) {
    if (screen[i * 3 + 2] <= PICK_MIN_Z) continue;
    const d = Math.hypot(screen[i * 3] - x, screen[i * 3 + 1] - y);
    if (d <= bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Rotation (as used by `rotateYX`) that turns v to face the viewer (+z). */
export function frontRotation(v: Vec3): { ry: number; rx: number } {
  return { ry: Math.atan2(-v[0], v[2]), rx: Math.atan2(v[1], Math.hypot(v[0], v[2])) };
}

/** The angle equal to `target` (mod 2π) nearest to `current`, so a spin never goes the long way round. */
export function nearestAngle(current: number, target: number): number {
  return target + TAU * Math.round((current - target) / TAU);
}

/** Index of the tile nearest the viewer under rotation (ry, rx); -1 for no tiles. */
export function frontIndex(points: readonly Vec3[], ry: number, rx: number): number {
  let best = -1;
  let bz = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const z = rotateYX(points[i], ry, rx)[2];
    if (z > bz) {
      bz = z;
      best = i;
    }
  }
  return best;
}

/**
 * Rotation that brings v to the front, nearest to the current (unbounded) rotation.
 * Two rotations face any point (upright, and rolled over the pole); taking the nearer
 * one means a wheel-rolled sphere settles forward instead of unwinding.
 */
export function frontRotationNear(v: Vec3, ry: number, rx: number): { ry: number; rx: number } {
  const a = frontRotation(v);
  const opts = [a, { ry: a.ry + Math.PI, rx: Math.PI - a.rx }].map((o) => ({
    ry: nearestAngle(ry, o.ry),
    rx: nearestAngle(rx, o.rx),
  }));
  const cost = (o: { ry: number; rx: number }) => Math.abs(o.ry - ry) + Math.abs(o.rx - rx);
  return cost(opts[0]) <= cost(opts[1]) ? opts[0] : opts[1];
}

const SPRING_STIFFNESS = 60;
const SPRING_DAMPING = 9;

/** One semi-implicit Euler step of an under-damped spring (about 10% overshoot): the springy settle. */
export function springStep(x: number, v: number, target: number, dt: number): { x: number; v: number } {
  const nv = v + (SPRING_STIFFNESS * (target - x) - SPRING_DAMPING * v) * dt;
  return { x: x + nv * dt, v: nv };
}

/** How far a spin at velocity v still travels under exponential friction (v' = -friction * v). */
export const coastDistance = (v: number, friction: number): number => (v === 0 ? 0 : v / friction);

const MAX_STRETCH = 0.3;

/** Dot stretch along its motion (0..0.3) for a spin speed in rad/s. */
export const spinStretch = (speed: number): number => Math.min(MAX_STRETCH, Math.abs(speed) * 0.035);

const IDLE_AFTER_S = 2;
const IDLE_RAMP_S = 1.5;

/** Share (0..1) of the idle auto-rotation, given seconds since the last wheel/drag/hover/focus input. */
export function idleEase(sinceInput: number): number {
  const x = clamp((sinceInput - IDLE_AFTER_S) / IDLE_RAMP_S, 0, 1);
  return x * x * (3 - 2 * x);
}

const RIPPLE_WAVES = 9;
const RIPPLE_FALLOFF = 0.6;

/**
 * Height (-1..1) of the "speaking" ripple at a point whose normal has cosine `c` with the
 * view direction; rings start at the front and travel outward as `phase` grows.
 * The dot shader (orb-shaders.ts) uses the same constants, so labels ride the same wave as their dots.
 */
export function rippleHeight(c: number, phase: number): number {
  const a = Math.acos(clamp(c, -1, 1));
  return Math.sin(a * RIPPLE_WAVES - phase) * Math.exp(-a * RIPPLE_FALLOFF);
}

const MIC_GAIN = 4;

/** 0..1 loudness from an AnalyserNode's byte time-domain samples (128 = silence). */
export function micLevel(samples: Uint8Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const b of samples) sum += ((b - 128) / 128) ** 2;
  return Math.min(1, Math.sqrt(sum / samples.length) * MIC_GAIN);
}

/** Index of the app that best matches a search: label prefix, then word prefix, then substring; -1 if none. */
export function matchApp(labels: readonly string[], query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return -1;
  const lower = labels.map((l) => l.toLowerCase());
  const tests = [
    (l: string) => l.startsWith(q),
    (l: string) => l.split(/\s+/).some((w) => w.startsWith(q)),
    (l: string) => l.includes(q),
  ];
  for (const test of tests) {
    const i = lower.findIndex(test);
    if (i >= 0) return i;
  }
  return -1;
}

export function orbState(s: { status: string; typing: boolean; error: boolean; listening?: boolean }): OrbState {
  if (s.error) return "error";
  if (s.listening) return "listening";
  if (s.status === "streaming") return "streaming";
  if (s.status === "submitted") return "submitted";
  return s.typing ? "typing" : "idle";
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
