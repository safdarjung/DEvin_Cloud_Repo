// Choreography of the landing page's opening scene, as pure functions of scroll progress.
//
// The scene: one product screen (the "hub", a board with seven empty slots) and seven cards floating round
// it. Each card starts as a loose paper thing the school uses today. In its own stretch of the scroll it
// flies to the front, flips over to the product screen that replaces it, and docks into its slot on the hub.
// When all seven are docked the hub turns to face the reader: one record.
//
// Units: lengths are fractions of the scene unit `u` (Scene3D sets it from the stage size); angles are
// degrees. A pose becomes the CSS transform `translate3d(x, y, z) rotateX rotateY rotateZ scale(s)`.
import { ACTS, problemWindow } from "../loom/weave.ts";
import { PROBLEMS } from "../story.ts";

export interface Pose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  s: number;
}

export type Vec3 = readonly [number, number, number];

/** The hub's size and its 4 x 2 grid of slots. home-scene.css lays the hub out with these same numbers. */
export const HUB = { w: 0.86, h: 0.5, header: 0.07, pad: 0.03, gap: 0.02, cols: 4, rows: 2 } as const;
export const SLOT = {
  w: (HUB.w - 2 * HUB.pad - (HUB.cols - 1) * HUB.gap) / HUB.cols,
  h: (HUB.h - HUB.header - 2 * HUB.pad - (HUB.rows - 1) * HUB.gap) / HUB.rows,
} as const;
/** A card at full size (as it is read at the front). It has the slot's proportions, so docking is one scale. */
export const PANEL = { w: 0.46, h: (0.46 * SLOT.h) / SLOT.w } as const;
export const DOCK_SCALE = SLOT.w / PANEL.w;
const LOOSE_SCALE = 0.42;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function mix(a: Pose, b: Pose, k: number): Pose {
  return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k), rx: lerp(a.rx, b.rx, k), ry: lerp(a.ry, b.ry, k), rz: lerp(a.rz, b.rz, k), s: lerp(a.s, b.s, k) };
}

const HUB_HERO: Pose = { x: 0, y: 0.01, z: 0, rx: 12, ry: -20, rz: 1.5, s: 1 };
const HUB_BACK: Pose = { x: 0.16, y: -0.25, z: -0.36, rx: 14, ry: -24, rz: 1, s: 0.92 };
const HUB_FRONT: Pose = { x: 0, y: -0.01, z: 0.08, rx: 3, ry: -6, rz: 0, s: 1.06 };
/** Where the hub sits while the film plays inside it: square on, a little larger. */
export const HUB_CINEMA: Pose = { x: 0, y: -0.01, z: 0.16, rx: 0, ry: 0, rz: 0, s: 1.12 };

/** The hub steps back while the cards are read one by one, then comes forward to be the answer. */
export function hubPose(p: number, time: number): Pose {
  const away = smoothstep(ACTS.hero[1] - 0.03, ACTS.problems[0] + 0.04, p);
  const home = smoothstep(ACTS.weave[0], ACTS.weave[0] + 0.16, p);
  const base = mix(mix(HUB_HERO, HUB_BACK, away), HUB_FRONT, home);
  return { ...base, y: base.y + Math.sin(time * 0.7) * 0.008, rz: base.rz + Math.sin(time * 0.45) * 0.5 };
}

/** Where each loose card floats: round the hub, in front of it, kept clear of the copy on the left. */
const LOOSE: readonly Pose[] = [
  { x: -0.42, y: -0.36, z: 0.24, rx: 10, ry: 24, rz: -9, s: LOOSE_SCALE },
  { x: -0.02, y: -0.45, z: 0.1, rx: -14, ry: -10, rz: 6, s: LOOSE_SCALE },
  { x: 0.36, y: -0.36, z: 0.2, rx: 12, ry: -26, rz: 10, s: LOOSE_SCALE },
  { x: 0.41, y: 0.04, z: 0.26, rx: -6, ry: -30, rz: -7, s: LOOSE_SCALE },
  { x: 0.3, y: 0.38, z: 0.16, rx: -16, ry: -14, rz: 8, s: LOOSE_SCALE },
  { x: 0.02, y: 0.45, z: 0.28, rx: -18, ry: 8, rz: -5, s: LOOSE_SCALE },
  { x: -0.47, y: 0.2, z: 0.2, rx: -8, ry: 26, rz: 11, s: LOOSE_SCALE },
];

/** A loose card drifts a little, each on its own beat. */
export function loosePose(i: number, time: number): Pose {
  const base = LOOSE[i % LOOSE.length];
  const beat = i * 1.7;
  return {
    ...base,
    x: base.x + Math.sin(time * 0.5 + beat) * 0.012,
    y: base.y + Math.cos(time * 0.6 + beat) * 0.016,
    rx: base.rx + Math.sin(time * 0.4 + beat) * 3,
    rz: base.rz + Math.cos(time * 0.35 + beat) * 2.5,
  };
}

/** Where a card is read: in front of everything, nearly square on. */
export const FOCUS: Pose = { x: -0.17, y: 0.15, z: 0.46, rx: 3, ry: -9, rz: 0, s: 1 };

/** Centre of slot i (row-major) relative to the hub's centre, before the hub's own transform. */
export function slotOffset(i: number): readonly [number, number] {
  const col = i % HUB.cols;
  const row = Math.floor(i / HUB.cols);
  return [-HUB.w / 2 + HUB.pad + SLOT.w / 2 + col * (SLOT.w + HUB.gap), -HUB.h / 2 + HUB.header + HUB.pad + SLOT.h / 2 + row * (SLOT.h + HUB.gap)];
}

const RAD = Math.PI / 180;

/** v turned by `rotateX(rx) rotateY(ry) rotateZ(rz)` exactly as CSS composes them (y down, z towards the reader). */
export function rotate(rx: number, ry: number, rz: number, v: Vec3): Vec3 {
  const [cz, sz] = [Math.cos(rz * RAD), Math.sin(rz * RAD)];
  const [cy, sy] = [Math.cos(ry * RAD), Math.sin(ry * RAD)];
  const [cx, sx] = [Math.cos(rx * RAD), Math.sin(rx * RAD)];
  const x1 = v[0] * cz - v[1] * sz;
  const y1 = v[0] * sz + v[1] * cz;
  const x2 = x1 * cy + v[2] * sy;
  const z2 = -x1 * sy + v[2] * cy;
  return [x2, y1 * cx - z2 * sx, y1 * sx + z2 * cx];
}

/** A card sitting in its slot: on the hub's plane, a hair in front of it, turned and scaled with the hub. */
export function dockPose(i: number, hub: Pose): Pose {
  const [ox, oy] = slotOffset(i);
  const [dx, dy, dz] = rotate(hub.rx, hub.ry, hub.rz, [ox * hub.s, oy * hub.s, 0.008 * hub.s]);
  return { x: hub.x + dx, y: hub.y + dy, z: hub.z + dz, rx: hub.rx, ry: hub.ry, rz: hub.rz, s: hub.s * DOCK_SCALE };
}

export interface PanelState {
  pose: Pose;
  /** 0 = paper side to the reader, 1 = product side. */
  flip: number;
  /** 1 while the card is at the front being read, 0 when loose or docked: fades its detail in and out. */
  detail: number;
  /** 0 loose, 1 in its slot. */
  docked: number;
}

/** Card i at progress p. `hub` is the hub's pose in the same frame (the card docks onto it). */
export function panelState(i: number, p: number, time: number, hub: Pose): PanelState {
  const [a, b] = problemWindow(i);
  const s = (p - a) / (b - a);
  const toFocus = smoothstep(0, 0.24, s);
  const flip = smoothstep(0.4, 0.58, s);
  // Docking runs a little into the next card's stretch, so one card leaves as the next arrives.
  const docked = smoothstep(0.78, 1.14, s);
  const read = mix(loosePose(i, time), FOCUS, toFocus);
  return { pose: mix(read, dockPose(i, hub), docked), flip, detail: toFocus * (1 - docked), docked };
}

/** 0..1: how far the thread that runs through all seven docked cards has been drawn. */
export function weaveProgress(p: number): number {
  return smoothstep(ACTS.weave[0] + 0.04, ACTS.weave[1] - 0.03, p);
}

export const PANEL_COUNT = PROBLEMS.length;

/** Where a card comes from when the page opens: further out and further back than where it floats. */
export function entryPose(i: number): Pose {
  const base = LOOSE[i % LOOSE.length];
  return { ...base, x: base.x * 1.7, y: base.y * 1.7, z: base.z - 0.9, rz: base.rz * 3, s: base.s * 0.6 };
}
