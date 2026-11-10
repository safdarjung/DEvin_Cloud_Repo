// Pure maths for the App Orb (no three.js, no React) so it is unit-testable.
export type Vec3 = readonly [number, number, number];
export type OrbState = "idle" | "typing" | "submitted" | "streaming" | "error";

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

export interface Bulge {
  /** Extra distance along the tile's normal, as a fraction of the sphere radius. */
  push: number;
  scale: number;
}

const HOVER_PUSH = 0.3;
const HOVER_SCALE = 1.35;
const NEIGHBOUR_PUSH = 0.1;
const NEIGHBOUR_SCALE = 0.1;
/** Neighbours within this cosine of the hovered tile are nudged. */
const NEIGHBOUR_COS = 0.55;

/** Spring targets: hovered tile bulges out, close neighbours nudge, the rest rest. */
export function bulgeTargets(points: readonly Vec3[], hovered: number | null): Bulge[] {
  const h = hovered !== null ? points[hovered] : undefined;
  return points.map((p, i) => {
    if (!h) return { push: 0, scale: 1 };
    if (i === hovered) return { push: HOVER_PUSH, scale: HOVER_SCALE };
    const dot = p[0] * h[0] + p[1] * h[1] + p[2] * h[2];
    if (dot <= NEIGHBOUR_COS) return { push: 0, scale: 1 };
    const w = (dot - NEIGHBOUR_COS) / (1 - NEIGHBOUR_COS);
    return { push: NEIGHBOUR_PUSH * w, scale: 1 + NEIGHBOUR_SCALE * w };
  });
}

export function orbState(s: { status: string; typing: boolean; error: boolean }): OrbState {
  if (s.error) return "error";
  if (s.status === "streaming") return "streaming";
  if (s.status === "submitted") return "submitted";
  return s.typing ? "typing" : "idle";
}

export interface Wave {
  amp: number;
  speed: number;
  shake: number;
}

const WAVES: Record<OrbState, Wave> = {
  idle: { amp: 0.08, speed: 0.5, shake: 0 },
  typing: { amp: 0.16, speed: 1.4, shake: 0 },
  submitted: { amp: 0.26, speed: 3, shake: 0 },
  streaming: { amp: 0.4, speed: 5.5, shake: 0 },
  error: { amp: 0.14, speed: 1.5, shake: 0.06 },
};

export const waveFor = (state: OrbState): Wave => WAVES[state];

const MAX_TILE_WIDTH = 88;
const MIN_TILE_WIDTH = 48;

/** Tile width in px so ~n tiles fit on a sphere of `radius` px without overlapping. */
export function tileWidth(n: number, radius: number): number {
  const area = (4 * Math.PI * radius * radius) / Math.max(n, 1);
  return Math.max(MIN_TILE_WIDTH, Math.min(MAX_TILE_WIDTH, Math.sqrt(area) * 0.8));
}

/** Rotate a vector about Y by `ry`, then about X by `rx`. */
export function rotateYX(v: Vec3, ry: number, rx: number): Vec3 {
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const x1 = v[0] * cy + v[2] * sy;
  const z1 = -v[0] * sy + v[2] * cy;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  return [x1, v[1] * cx - z1 * sx, v[1] * sx + z1 * cx];
}
