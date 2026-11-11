import { describe, expect, test } from "vitest";
import { JOINTS, REST, gesture, poseAt, stampLift, type Action } from "@/components/tour/scene/characters/rig";
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

describe("person rig poses", () => {
  const ACTIONS: Action[] = ["point", "stamp", "write", "read", "phone", "wave", "walk", "swing", "sit", "stand"];

  test("every action yields finite joint angles within a human range at any time", () => {
    const pose = { ...REST };
    for (const action of ACTIONS)
      for (let t = 0; t < 30; t += 0.37) {
        poseAt(action, t, t % 2 > 1 ? 1 : 0, pose);
        for (const joint of JOINTS) {
          expect(Number.isFinite(pose[joint]), `${action}.${joint}`).toBe(true);
          expect(Math.abs(pose[joint]), `${action}.${joint}`).toBeLessThan(Math.PI);
        }
      }
  });

  test("the greeting lifts the right arm above the shoulder and leaves the left arm alone", () => {
    const idle = poseAt("stand", 1, 0, { ...REST });
    const waving = poseAt("stand", 1, 1, { ...REST });
    expect(waving.rSz).toBeLessThan(-1.6);
    expect(waving.lSz).toBe(idle.lSz);
  });

  test("a gesture is 0 outside its window, winds up below 0, overshoots, holds at 1 and repeats", () => {
    const g = (t: number) => gesture(t, 10, 2, 4);
    expect(g(1.9)).toBe(0);
    expect(g(6.1)).toBe(0);
    expect(g(2.05)).toBeLessThan(0);
    expect(g(4)).toBe(1);
    expect(g(14)).toBe(1);
    expect(g(-6)).toBe(1);
    let peak = 0;
    for (let t = 2; t < 6; t += 0.01) {
      const v = g(t);
      expect(v).toBeGreaterThan(-0.2);
      expect(v).toBeLessThan(1.2);
      peak = Math.max(peak, v);
    }
    expect(peak).toBeGreaterThan(1.02);
    expect(g(5.95)).toBeLessThan(0.2);
  });

  test("each room's person does more than one thing in a loop", () => {
    const at = (action: Action, t: number) => poseAt(action, t, 0, { ...REST });
    // Principal: arm up to the screen, then down with an open hand.
    expect(at("point", 3).rSz).toBeLessThan(-1.3);
    expect(at("point", 8).rSz).toBeGreaterThan(-0.6);
    // Admin: the left hand slides the slip forward and the stamp rests.
    expect(at("stamp", 8.5).lSx).toBeLessThan(at("stamp", 3).lSx - 0.3);
    // Teacher: turned to the easel while writing, to the class while explaining.
    expect(at("write", 2).turn).toBeLessThan(-0.5);
    expect(at("write", 7).turn).toBeGreaterThan(-0.2);
    // Student: the fist goes up. Parent: the phone arm swings out to the side.
    expect(at("read", 8.2).rSx).toBeLessThan(at("read", 4).rSx - 1);
    expect(at("phone", 7).lSz).toBeGreaterThan(at("phone", 2).lSz + 0.8);
  });

  test("the stamp is lifted slowly and comes down fast, staying between 0 and 1", () => {
    let rising = 0;
    let falling = 0;
    for (let t = 0; t < 1 / 0.85; t += 0.005) {
      const now = stampLift(t);
      expect(now).toBeGreaterThanOrEqual(0);
      expect(now).toBeLessThanOrEqual(1);
      const delta = stampLift(t + 0.005) - now;
      if (delta > 1e-4) rising++;
      else if (delta < -1e-4) falling++;
    }
    expect(rising).toBeGreaterThan(falling * 1.5);
  });
});
