import { describe, expect, test } from "vitest";
import { ACTS, problemWindow } from "../../src/components/home/loom/weave.ts";
import { DOCK_SCALE, FOCUS, HUB, PANEL, PANEL_COUNT, SLOT, dockPose, hubPose, panelState, rotate, slotOffset, weaveProgress, type Pose } from "../../src/components/home/scene/pose.ts";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const samePose = (a: Pose, b: Pose) => (Object.keys(a) as (keyof Pose)[]).every((k) => near(a[k], b[k]));
const mid = (i: number, s: number) => {
  const [a, b] = problemWindow(i);
  return a + (b - a) * s;
};

describe("landing scene geometry", () => {
  test("rotate matches CSS rotateX / rotateY / rotateZ", () => {
    expect(rotate(0, 0, 0, [1, 2, 3])).toEqual([1, 2, 3]);
    const [x, y, z] = rotate(0, 90, 0, [1, 0, 0]);
    expect([near(x, 0), near(y, 0), near(z, -1)]).toEqual([true, true, true]);
    const [x2, y2, z2] = rotate(90, 0, 0, [0, 1, 0]);
    expect([near(x2, 0), near(y2, 0), near(z2, 1)]).toEqual([true, true, true]);
    const [x3, y3] = rotate(0, 0, 90, [1, 0, 0]);
    expect([near(x3, 0), near(y3, 1)]).toEqual([true, true]);
  });

  test("the seven slots sit inside the board, apart from each other, and a docked card fills one exactly", () => {
    expect(PANEL_COUNT).toBeLessThan(HUB.cols * HUB.rows + 1);
    const seen = new Set<string>();
    for (let i = 0; i < PANEL_COUNT; i++) {
      const [x, y] = slotOffset(i);
      expect(Math.abs(x) + SLOT.w / 2).toBeLessThanOrEqual(HUB.w / 2 - HUB.pad + 1e-9);
      expect(y - SLOT.h / 2).toBeGreaterThanOrEqual(-HUB.h / 2 + HUB.header + HUB.pad - 1e-9);
      expect(y + SLOT.h / 2).toBeLessThanOrEqual(HUB.h / 2 - HUB.pad + 1e-9);
      seen.add(`${x.toFixed(4)},${y.toFixed(4)}`);
    }
    expect(seen.size).toBe(PANEL_COUNT);
    expect(near(PANEL.w * DOCK_SCALE, SLOT.w)).toBe(true);
    expect(near(PANEL.h * DOCK_SCALE, SLOT.h)).toBe(true);
  });

  test("a docked card lies on the board's plane and turns with it", () => {
    const flat: Pose = { x: 0.1, y: -0.2, z: 0.3, rx: 0, ry: 0, rz: 0, s: 1 };
    const [ox, oy] = slotOffset(5);
    const d = dockPose(5, flat);
    expect(near(d.x, flat.x + ox) && near(d.y, flat.y + oy)).toBe(true);
    expect(d.z).toBeGreaterThan(flat.z);
    const turned = dockPose(5, { ...flat, ry: -24, rx: 14 });
    expect([turned.rx, turned.ry]).toEqual([14, -24]);
  });
});

describe("landing scene choreography", () => {
  test("each card is loose paper before its turn, read at the front during it, and docked product after it", () => {
    for (let i = 0; i < PANEL_COUNT; i++) {
      const before = panelState(i, mid(i, -0.2), 0, hubPose(mid(i, -0.2), 0));
      expect([before.flip, before.detail, before.docked]).toEqual([0, 0, 0]);

      const reading = panelState(i, mid(i, 0.33), 0, hubPose(mid(i, 0.33), 0));
      expect(samePose(reading.pose, FOCUS)).toBe(true);
      expect([reading.flip, reading.detail]).toEqual([0, 1]);

      const answered = panelState(i, mid(i, 0.7), 0, hubPose(mid(i, 0.7), 0));
      expect([answered.flip, answered.detail]).toEqual([1, 1]);

      const p = mid(i, 1.2);
      const hub = hubPose(p, 0);
      const after = panelState(i, p, 0, hub);
      expect([after.flip, after.detail, after.docked]).toEqual([1, 0, 1]);
      expect(samePose(after.pose, dockPose(i, hub))).toBe(true);
    }
  });

  test("the thread is drawn only once every card is docked (the last one finishes just inside the finale)", () => {
    const step = 0.001;
    let threadStart = ACTS.weave[0];
    while (weaveProgress(threadStart + step) === 0) threadStart += step;
    expect(threadStart).toBeGreaterThan(ACTS.weave[0]);
    const hub = hubPose(threadStart, 0);
    for (let i = 0; i < PANEL_COUNT; i++) expect(panelState(i, threadStart, 0, hub).docked).toBe(1);
    expect(weaveProgress(ACTS.hold[0])).toBe(1);
  });

  test("nothing teleports: a small scroll step moves the board and every card only a little", () => {
    const STEP = 0.002;
    const MAX_JUMP = 0.12; // scene units per step; the fastest real move (a card flying to its slot) peaks near 0.09
    for (let p = 0; p < 1; p += STEP) {
      const h0 = hubPose(p, 0);
      const h1 = hubPose(p + STEP, 0);
      expect(Math.hypot(h1.x - h0.x, h1.y - h0.y, h1.z - h0.z)).toBeLessThan(MAX_JUMP);
      for (let i = 0; i < PANEL_COUNT; i++) {
        const a = panelState(i, p, 0, h0).pose;
        const b = panelState(i, p + STEP, 0, h1).pose;
        expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), `card ${i} at ${p.toFixed(3)}`).toBeLessThan(MAX_JUMP);
      }
    }
  });
});
