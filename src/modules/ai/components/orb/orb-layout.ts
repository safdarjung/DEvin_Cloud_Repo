// Pure maths for the App Orb (no three.js, no React) so it is unit-testable.
export type Vec3 = readonly [number, number, number];
export type OrbState = "idle" | "listening" | "typing" | "submitted" | "streaming" | "error";

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
