import { CatmullRomCurve3, Vector3 } from "three";
import type { TourRoleKey } from "./roles";

/**
 * Pure camera path for the scroll tour. World units ≈ metres, +z points back at the visitor:
 * gate at z=10, school facade at z=0, corridor runs down -z with rooms off both sides.
 */
export type StopKey = "gate" | TourRoleKey;
export type Vec3 = readonly [number, number, number];
export interface TourStop {
  key: StopKey;
  /** Progress window this stop owns (windows tile 0..1). */
  start: number;
  end: number;
  /** Camera holds its pose while progress is inside this range. */
  dwell: readonly [number, number];
  pose: { position: Vec3; target: Vec3 };
}

export const GATE_Z = 10;
export const CORRIDOR_HALF = 2.2;
export const CORRIDOR_END_Z = -44;
/** Half-width of each room doorway in the corridor wall. */
export const DOOR_HALF = 1.8;
/** Room centre distance from the corridor axis; room half-size in its own frame. */
export const ROOM_X = 6.7;
export const ROOM_HALF = { x: 4.5, z: 3.6 } as const;
export const ROOM_ORDER: readonly TourRoleKey[] = ["principal", "admin", "teacher", "student", "parent"];
export const ROOMS: Readonly<Record<TourRoleKey, { side: 1 | -1; z: number }>> = {
  principal: { side: -1, z: -7 },
  admin: { side: 1, z: -15 },
  teacher: { side: -1, z: -23 },
  student: { side: 1, z: -31 },
  parent: { side: -1, z: -39 },
};
/** Where each room's mascot stands, room-local; the dwell camera frames it right of centre (cards sit left). */
export const MASCOT_SPOT: Vec3 = [0.8, 0, 0.6];

/** Room-local → world. Local +x points away from the corridor; left rooms are right rooms turned 180°. */
export function roomToWorld(key: TourRoleKey, [x, y, z]: Vec3): Vec3 {
  const { side, z: rz } = ROOMS[key];
  return [side * (ROOM_X + x), y, rz + side * z];
}

/* Scroll length in "units" (the page maps one unit to a fixed share of viewport height). */
const GATE_DWELL = 0.5;
const ENTRY_TRANSIT = 2;
const ROOM_DWELL = 1;
const ROOM_TRANSIT = 0.9;
export const TOUR_UNITS = GATE_DWELL + ENTRY_TRANSIT + ROOM_ORDER.length * ROOM_DWELL + (ROOM_ORDER.length - 1) * ROOM_TRANSIT;
const FADE = 0.3 / TOUR_UNITS;

type Key = { position: Vec3; target: Vec3; stop?: StopKey };
const at = (x: number, y: number, z: number): Vec3 => [x, y, z];

function buildKeys(): Key[] {
  const keys: Key[] = [
    { position: at(0, 3, 21), target: at(0, 3.4, 2), stop: "gate" },
    { position: at(0, 2.3, 13), target: at(0, 2.2, 0) },
    { position: at(0, 2, 5), target: at(0, 1.9, -4) },
    { position: at(0, 1.9, 1.2), target: at(0, 1.8, -8) },
  ];
  ROOM_ORDER.forEach((key, i) => {
    const rz = ROOMS[key].z;
    keys.push({ position: at(0, 1.85, rz + 2.5), target: roomToWorld(key, [0.5, 1.3, 0]) });
    keys.push({ position: roomToWorld(key, [-2.6, 1.6, 0.3]), target: roomToWorld(key, [1.7, 0.95, -0.7]), stop: key });
    const next = ROOM_ORDER[i + 1];
    if (next) keys.push({ position: at(0, 1.85, rz - 2.5), target: at(ROOMS[next].side * CORRIDOR_HALF, 1.6, ROOMS[next].z) });
  });
  return keys;
}

const KEYS = buildKeys();
const toV = (v: Vec3) => new Vector3(...v);
const posCurve = new CatmullRomCurve3(KEYS.map((k) => toV(k.position)), false, "centripetal");
const lookCurve = new CatmullRomCurve3(KEYS.map((k) => toV(k.target)), false, "centripetal");
const PER_SEGMENT = 40;
posCurve.arcLengthDivisions = (KEYS.length - 1) * PER_SEGMENT;
const lengths = posCurve.getLengths();
const total = lengths[lengths.length - 1];

function buildStops(): TourStop[] {
  const spans = ROOM_ORDER.map(() => ROOM_DWELL);
  const transits = [ENTRY_TRANSIT, ...ROOM_ORDER.slice(1).map(() => ROOM_TRANSIT)];
  const dwellUnits = [GATE_DWELL, ...spans];
  let cursor = 0;
  const dwells = dwellUnits.map((d, i) => {
    const range = [cursor / TOUR_UNITS, Math.min(1, (cursor + d) / TOUR_UNITS)] as const;
    cursor += d + (transits[i] ?? 0);
    return range;
  });
  const stopKeys = KEYS.filter((k) => k.stop);
  return stopKeys.map((k, i) => ({
    key: k.stop!,
    start: i === 0 ? 0 : (dwells[i - 1][1] + dwells[i][0]) / 2,
    end: i === stopKeys.length - 1 ? 1 : (dwells[i][1] + dwells[i + 1][0]) / 2,
    dwell: dwells[i],
    pose: { position: k.position, target: k.target },
  }));
}

export const STOPS: readonly TourStop[] = buildStops();
/** Arc-length fraction of each stop's control point on the camera curve. */
const STOP_U = KEYS.flatMap((k, i) => (k.stop ? [lengths[i * PER_SEGMENT] / total] : []));

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

export function stopIndexAt(progress: number): number {
  const p = clamp01(progress);
  let i = 0;
  while (i < STOPS.length - 1 && p >= STOPS[i + 1].start) i++;
  return i;
}

export function stopAt(progress: number): TourStop {
  return STOPS[stopIndexAt(progress)];
}

/** Scroll progress → arc-length position on the camera curve: held during dwells, eased between them. */
export function pathParamAt(progress: number): number {
  const p = clamp01(progress);
  for (let i = 0; i < STOPS.length; i++) {
    const [a, b] = STOPS[i].dwell;
    if (p <= b) {
      if (p >= a || i === 0) return STOP_U[i];
      const prevEnd = STOPS[i - 1].dwell[1];
      return STOP_U[i - 1] + (STOP_U[i] - STOP_U[i - 1]) * smooth((p - prevEnd) / (a - prevEnd));
    }
  }
  return 1;
}

export function cameraAt(progress: number): { position: Vector3; lookAt: Vector3 } {
  const u = pathParamAt(progress);
  const t = posCurve.getUtoTmapping(u, u * total);
  return { position: posCurve.getPoint(t), lookAt: lookCurve.getPoint(t) };
}

/** 1 inside a stop's dwell, ramping to 0 over a short margin either side (drives overlay fades). */
export function dwellAmount(progress: number, stop: TourStop): number {
  const [a, b] = stop.dwell;
  const outside = progress < a ? a - progress : progress > b ? progress - b : 0;
  return clamp01(1 - outside / FADE);
}

/** Centre of a stop's dwell: where "jump to stop" scrolls. */
export const dwellCentre = (stop: TourStop) => (stop.dwell[0] + stop.dwell[1]) / 2;
