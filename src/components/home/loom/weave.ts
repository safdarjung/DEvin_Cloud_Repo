// Pure layout and timing for the opening film of the landing page: a tangle of yarn that is pulled out
// thread by thread (one per problem) and then woven into a plain-weave cloth. The vertex shader in
// yarn-shader.ts runs the same curve on the GPU; `threadPoint` is its CPU twin, used to pin DOM tags to a
// thread and by the unit test. Keep the two in step.
import { PROBLEMS, THREADS } from "../story.ts";

/** Warp count = weft count. Even, so the seven problem threads sit on every other weft lane. */
export const LANES = 14;
export const SPACING = 0.36;
export const RADIUS = 0.088;
export const TANGLE_R = 1.7;
/** How far each thread runs past the cloth edge, in lanes. */
export const OVERHANG = 0.8;
/** Side length of the woven cloth including overhang, world units. */
export const CLOTH = (LANES - 1 + OVERHANG * 2) * SPACING;

/** Acts of the film as [start, end] fractions of its scroll progress. */
export const ACTS = {
  hero: [0, 0.07],
  problems: [0.07, 0.7],
  weave: [0.7, 0.93],
  hold: [0.93, 1],
} as const;

export interface YarnThread {
  /** 0 = warp (runs along y), 1 = weft (runs along x). */
  kind: 0 | 1;
  lane: number;
  color: string;
  seed: readonly [number, number, number, number];
  /** Progress at which this thread starts leaving the tangle, and how long the trip takes. */
  start: number;
  dur: number;
  /** Index into PROBLEMS when this is the thread a problem card pulls out, else -1. */
  problem: number;
}

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** [start, end] of problem card i within the film's progress. */
export function problemWindow(i: number): readonly [number, number] {
  const [a, b] = ACTS.problems;
  const slot = (b - a) / PROBLEMS.length;
  return [a + i * slot, a + (i + 1) * slot];
}

/** Which problem card is on screen at progress p, or -1 (hero, weave, hold). */
export function problemAt(p: number): number {
  const [a, b] = ACTS.problems;
  if (p < a || p >= b) return -1;
  return Math.min(PROBLEMS.length - 1, Math.floor(((p - a) / (b - a)) * PROBLEMS.length));
}

export type Act = keyof typeof ACTS;
export function actAt(p: number): Act {
  if (p < ACTS.hero[1]) return "hero";
  if (p < ACTS.problems[1]) return "problems";
  if (p < ACTS.weave[1]) return "weave";
  return "hold";
}

export function buildThreads(): YarnThread[] {
  const rand = mulberry32(20261113);
  const seed = () => [rand(), rand(), rand(), rand()] as const;
  const [w0, w1] = ACTS.weave;
  const span = w1 - w0;
  const late = () => ({ start: w0 + rand() * span * 0.5, dur: span * 0.42 });
  const threads: YarnThread[] = [];
  for (let lane = 0; lane < LANES; lane++) {
    // Wefts: even lanes are the seven problem threads, in story order from the top.
    const problem = lane % 2 === 0 ? lane / 2 : -1;
    const color = THREADS[(problem >= 0 ? problem : (lane + 3) >> 1) % THREADS.length].color;
    if (problem >= 0 && problem < PROBLEMS.length) {
      const [a, b] = problemWindow(problem);
      threads.push({ kind: 1, lane, color, seed: seed(), start: a + (b - a) * 0.04, dur: (b - a) * 0.5, problem });
    } else {
      threads.push({ kind: 1, lane, color, seed: seed(), ...late(), problem: -1 });
    }
  }
  for (let lane = 0; lane < LANES; lane++) {
    threads.push({ kind: 0, lane, color: THREADS[(lane * 3 + 1) % THREADS.length].color, seed: seed(), ...late(), problem: -1 });
  }
  return threads;
}

const TAU = Math.PI * 2;
const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => smooth(clamp01((x - a) / (b - a)));

/** 0 while the thread is in the tangle, 1 once it lies in the cloth. */
export function threadWeave(th: YarnThread, p: number): number {
  return smooth(clamp01((p - th.start) / th.dur));
}

export type Vec3 = [number, number, number];

/**
 * The tangle's radius and centre at progress p: as problem threads are pulled out it shrinks and drifts up
 * and to the right, so the straightened threads below it can be seen.
 */
export function tangleAt(p: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const k = smoothstep(ACTS.problems[0], ACTS.problems[1], p);
  out[0] = TANGLE_R * (1 - 0.36 * k);
  out[1] = 0.55 * k;
  out[2] = 1.05 * k;
  return out;
}

const TANGLE: Vec3 = [0, 0, 0];

/** Centre line of thread `th` at parameter t (0..1 along its length), film progress p and time (seconds). */
export function threadPoint(th: YarnThread, t: number, p: number, time: number, out: Vec3 = [0, 0, 0]): Vec3 {
  const [sx, sy, sz, sw] = th.seed;
  // Tangle: a three-frequency knot that never quite closes.
  const a = t * TAU * 0.94;
  const f1 = 2 + Math.floor(sx * 3);
  const f2 = 3 + Math.floor(sy * 3);
  const f3 = 1 + Math.floor(sz * 4);
  const [tangleR, tangleX, tangleY] = tangleAt(p, TANGLE);
  const r = (0.74 + 0.26 * Math.sin(a * (f1 + f2) + sz * TAU)) * tangleR;
  const tx = Math.sin(a * f1 + sw * TAU + time * 0.23) * r + tangleX;
  const ty = Math.sin(a * f2 + sx * TAU - time * 0.19) * r * 0.86 + tangleY;
  const tz = Math.cos(a * f3 + sy * TAU + time * 0.15) * r * 0.7;
  // Cloth: a straight lane, bobbing over and under every thread it crosses.
  const half = (LANES - 1) / 2;
  const along = (t - 0.5) * CLOTH;
  const lanePos = (th.lane - half) * SPACING;
  const cross = along / SPACING + half;
  const inside = smoothstep(-0.9, -0.1, cross) * smoothstep(LANES - 0.1, LANES - 0.9, cross);
  const z = Math.cos(Math.PI * cross) * (th.lane % 2 === 0 ? 1 : -1) * RADIUS * 1.12 * inside;
  const cx = th.kind === 0 ? lanePos : along;
  const cy = th.kind === 0 ? along : lanePos;
  const cz = th.kind === 0 ? z : -z;
  const w = threadWeave(th, p);
  out[0] = tx + (cx - tx) * w;
  out[1] = ty + (cy - ty) * w;
  out[2] = tz + (cz - tz) * w + Math.sin(w * Math.PI) * 0.9;
  return out;
}
