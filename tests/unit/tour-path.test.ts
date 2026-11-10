import { describe, expect, test } from "vitest";
import { BACK_DOOR, CORRIDOR_END_Z, CORRIDOR_HALF, DOOR_HALF, FINALE_Z, GATE_Z, ROOM_HALF, ROOM_ORDER, ROOM_X, ROOMS, STOPS, cameraAt, dwellAmount, pathParamAt, stopAt } from "@/components/tour/path";

const ORDER = ["gate", "principal", "admin", "teacher", "student", "parent", "finale"];
const samples = Array.from({ length: 1001 }, (_, i) => i / 1000);
const mid = (r: readonly [number, number]) => (r[0] + r[1]) / 2;

describe("tour path", () => {
  test("stops run gate, the five rooms in order, then the finale outside", () => {
    expect(STOPS.map((s) => s.key)).toEqual(ORDER);
  });

  test("stop windows tile 0..1 and dwell windows sit inside them without overlapping", () => {
    expect(STOPS[0].start).toBe(0);
    expect(STOPS.at(-1)!.end).toBe(1);
    STOPS.forEach((s, i) => {
      expect(s.dwell[0]).toBeGreaterThanOrEqual(s.start);
      expect(s.dwell[1]).toBeLessThanOrEqual(s.end);
      expect(s.dwell[0]).toBeLessThan(s.dwell[1]);
      const next = STOPS[i + 1];
      if (next) {
        expect(next.start).toBe(s.end);
        expect(s.dwell[1]).toBeLessThan(next.dwell[0]);
      }
    });
  });

  test("progress 0 is outside the gate", () => {
    expect(stopAt(0).key).toBe("gate");
    expect(cameraAt(0).position.z).toBeGreaterThan(GATE_Z);
  });

  test("the parent stop dwells inside the parent lounge", () => {
    const parent = STOPS.find((s) => s.key === "parent")!;
    const { position } = cameraAt(mid(parent.dwell));
    const room = ROOMS.parent;
    expect(Math.sign(position.x)).toBe(room.side);
    expect(Math.abs(position.x)).toBeGreaterThan(ROOM_X - ROOM_HALF.x);
    expect(Math.abs(position.z - room.z)).toBeLessThan(ROOM_HALF.z);
  });

  test("progress 1 is the finale, outside behind the school and looking at the mascots", () => {
    expect(stopAt(1).key).toBe("finale");
    const { position, lookAt } = cameraAt(1);
    expect(position.z).toBeLessThan(CORRIDOR_END_Z - 2);
    expect(lookAt.z).toBeLessThan(position.z);
    expect(Math.abs(lookAt.z - FINALE_Z)).toBeLessThan(1);
  });

  test("every stop is reachable and the camera holds its pose through the dwell", () => {
    for (const s of STOPS) {
      expect(stopAt(mid(s.dwell)).key).toBe(s.key);
      for (const p of [s.dwell[0], mid(s.dwell), s.dwell[1]]) {
        const { position, lookAt } = cameraAt(p);
        expect(position.toArray().map((v) => +v.toFixed(3))).toEqual(s.pose.position.map((v) => +v.toFixed(3)));
        expect(lookAt.toArray().map((v) => +v.toFixed(3))).toEqual(s.pose.target.map((v) => +v.toFixed(3)));
      }
    }
  });

  test("the camera only moves forward: path parameter, stop index and depth never go back", () => {
    let prevU = -1;
    let prevStop = -1;
    let prevZ = Infinity;
    for (const p of samples) {
      const u = pathParamAt(p);
      const idx = ORDER.indexOf(stopAt(p).key);
      const z = cameraAt(p).position.z;
      expect(u).toBeGreaterThanOrEqual(prevU);
      expect(idx).toBeGreaterThanOrEqual(prevStop);
      expect(z).toBeLessThanOrEqual(prevZ + 1e-6);
      prevU = u;
      prevStop = idx;
      prevZ = z;
    }
    expect(pathParamAt(0)).toBe(0);
    expect(pathParamAt(1)).toBe(1);
  });

  test("the camera only crosses walls through the front door, room doorways and the back door", () => {
    const MARGIN = 0.3; // room for pointer parallax and the near plane
    for (const p of samples) {
      const { x, y, z } = cameraAt(p).position;
      if (z > 0.3) continue; // still outside
      if (z > -0.7) {
        // front door: x ±1.4, 3.2 high (scene/Building.tsx)
        expect(Math.abs(x)).toBeLessThan(1.4 - MARGIN);
        expect(y).toBeLessThan(3.2 - MARGIN);
        continue;
      }
      if (z < CORRIDOR_END_Z - 0.8) continue; // out the back, in the playground
      if (z < CORRIDOR_END_Z + 0.3) {
        expect(Math.abs(x)).toBeLessThan(BACK_DOOR.half - MARGIN);
        expect(y).toBeLessThan(BACK_DOOR.height - MARGIN);
        continue;
      }
      if (Math.abs(x) < CORRIDOR_HALF - MARGIN) continue; // in the corridor
      const room = ROOM_ORDER.map((k) => ROOMS[k]).find((r) => r.side === Math.sign(x) && Math.abs(z - r.z) < ROOM_HALF.z);
      expect(room, `camera at x=${x.toFixed(2)} z=${z.toFixed(2)} is inside a wall`).toBeDefined();
      if (Math.abs(x) < CORRIDOR_HALF + 0.2 + MARGIN) expect(Math.abs(z - room!.z)).toBeLessThan(DOOR_HALF - MARGIN);
      expect(Math.abs(x)).toBeLessThan(ROOM_X + ROOM_HALF.x - MARGIN);
    }
  });

  test("out-of-range progress clamps", () => {
    expect(stopAt(-0.5).key).toBe("gate");
    expect(stopAt(2).key).toBe("finale");
    expect(pathParamAt(-1)).toBe(0);
    expect(pathParamAt(5)).toBe(1);
  });

  test("dwellAmount is 1 inside a dwell and 0 deep in the transit", () => {
    const principal = STOPS[1];
    expect(dwellAmount(mid(principal.dwell), principal)).toBe(1);
    expect(dwellAmount(principal.start, principal)).toBe(0);
    expect(dwellAmount(STOPS[3].dwell[0], principal)).toBe(0);
  });
});
