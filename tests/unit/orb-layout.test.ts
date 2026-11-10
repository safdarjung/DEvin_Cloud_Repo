import { describe, expect, it } from "vitest";
import { bulgeTargets, fibonacciSphere, orbState, rotateYX, tileWidth, waveFor } from "@/modules/ai/components/orb/orb-layout";

const len = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe("fibonacciSphere", () => {
  it("returns n unit vectors", () => {
    const pts = fibonacciSphere(24);
    expect(pts).toHaveLength(24);
    for (const p of pts) expect(len(p)).toBeCloseTo(1, 6);
  });

  it("handles 0 and 1 tiles", () => {
    expect(fibonacciSphere(0)).toEqual([]);
    expect(fibonacciSphere(1)).toHaveLength(1);
  });

  it("spreads points: no two coincide and both poles are covered", () => {
    const pts = fibonacciSphere(30);
    let min = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) min = Math.min(min, dist(pts[i], pts[j]));
    expect(min).toBeGreaterThan(0.2);
    expect(Math.max(...pts.map((p) => p[1]))).toBeGreaterThan(0.9);
    expect(Math.min(...pts.map((p) => p[1]))).toBeLessThan(-0.9);
  });
});

describe("bulgeTargets", () => {
  const pts = fibonacciSphere(20);

  it("is neutral with no hover", () => {
    for (const t of bulgeTargets(pts, null)) expect(t).toEqual({ push: 0, scale: 1 });
  });

  it("hovered tile bulges most; near neighbours nudge; far tiles stay put", () => {
    const t = bulgeTargets(pts, 3);
    expect(t[3].push).toBeGreaterThan(0.2);
    expect(t[3].scale).toBeGreaterThan(1.2);
    for (let i = 0; i < pts.length; i++) {
      if (i === 3) continue;
      expect(t[i].push).toBeLessThan(t[3].push);
      const d = dist(pts[i], pts[3]);
      if (d > 1.2) expect(t[i]).toEqual({ push: 0, scale: 1 });
    }
    expect(t.some((x, i) => i !== 3 && x.push > 0)).toBe(true);
  });

  it("ignores an out-of-range hover index", () => {
    expect(bulgeTargets(pts, 99).every((x) => x.push === 0)).toBe(true);
  });
});

describe("orbState / waveFor", () => {
  it("maps chat status to a state; error wins", () => {
    expect(orbState({ status: "ready", typing: false, error: false })).toBe("idle");
    expect(orbState({ status: "ready", typing: true, error: false })).toBe("typing");
    expect(orbState({ status: "submitted", typing: true, error: false })).toBe("submitted");
    expect(orbState({ status: "streaming", typing: false, error: false })).toBe("streaming");
    expect(orbState({ status: "ready", typing: false, error: true })).toBe("error");
  });

  it("streaming is the strongest ripple, idle the calmest, error shakes", () => {
    expect(waveFor("streaming").amp).toBeGreaterThan(waveFor("submitted").amp);
    expect(waveFor("submitted").amp).toBeGreaterThan(waveFor("typing").amp);
    expect(waveFor("typing").amp).toBeGreaterThan(waveFor("idle").amp);
    expect(waveFor("idle").amp).toBeGreaterThan(0);
    expect(waveFor("error").shake).toBeGreaterThan(0);
    expect(waveFor("idle").shake).toBe(0);
  });
});

describe("tileWidth", () => {
  it("shrinks as tiles grow and stays within 48..88px", () => {
    expect(tileWidth(8, 60)).toBeGreaterThan(tileWidth(40, 60));
    expect(tileWidth(1, 300)).toBe(88);
    expect(tileWidth(0, 300)).toBe(88);
    expect(tileWidth(200, 50)).toBe(48);
  });
});

describe("rotateYX", () => {
  it("keeps length and turns +z toward +x for a quarter turn about Y", () => {
    const r = rotateYX([0, 0, 1], Math.PI / 2, 0);
    expect(r[0]).toBeCloseTo(1, 6);
    expect(r[2]).toBeCloseTo(0, 6);
    expect(len(rotateYX([0.3, 0.5, 0.8], 1.2, -0.4))).toBeCloseTo(len([0.3, 0.5, 0.8]), 6);
  });
});
