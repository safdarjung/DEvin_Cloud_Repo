import { describe, expect, it } from "vitest";
import {
  coastDistance, dotField, fibonacciSphere, frontIndex, frontRotation, frontRotationNear, idleEase, matchApp, micLevel,
  nearestAngle, orbState, pickDot, rippleHeight, rotateYX, scatterEnvelope, spinStretch, springStep, waveFor,
} from "@/modules/ai/components/orb/orb-layout";
import { orbChips } from "@/modules/ai/components/orb/orb-chips";
import { CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";

const len = (v: readonly number[]) => Math.hypot(v[0], v[1], v[2]);
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const angle = (a: readonly number[], b: readonly number[]) => Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

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

describe("frontRotation / nearestAngle", () => {
  it("brings any tile normal to face the viewer (+z)", () => {
    for (const v of fibonacciSphere(17)) {
      const { ry, rx } = frontRotation(v);
      const r = rotateYX(v, ry, rx);
      expect(r[0]).toBeCloseTo(0, 6);
      expect(r[1]).toBeCloseTo(0, 6);
      expect(r[2]).toBeCloseTo(1, 6);
    }
  });

  it("picks the equivalent angle closest to the current one (no long way round)", () => {
    expect(nearestAngle(0, 0.5)).toBeCloseTo(0.5, 9);
    expect(nearestAngle(10 * Math.PI, 0.5)).toBeCloseTo(10 * Math.PI + 0.5, 9);
    expect(nearestAngle(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.1, 9);
    expect(Math.abs(nearestAngle(3, -3) - 3)).toBeLessThanOrEqual(Math.PI);
  });
});

describe("rippleHeight", () => {
  it("stays within -1..1", () => {
    for (let c = -1; c <= 1; c += 0.05) for (let ph = 0; ph < 10; ph += 0.7) {
      const h = rippleHeight(c, ph);
      expect(h).toBeGreaterThanOrEqual(-1);
      expect(h).toBeLessThanOrEqual(1);
    }
  });

  it("travels outward from the front: a crest near the front moves further out as the phase grows", () => {
    const crest = (phase: number) => {
      let best = -Infinity, at = 0;
      for (let a = 0; a < 0.6; a += 0.001) {
        const h = rippleHeight(Math.cos(a), phase);
        if (h > best) { best = h; at = a; }
      }
      return at;
    };
    expect(crest(Math.PI / 2 + 0.6)).toBeGreaterThan(crest(Math.PI / 2 + 0.2));
  });
});

describe("micLevel", () => {
  it("is 0 for silence, 1 for a full-scale signal, and grows with loudness", () => {
    expect(micLevel(new Uint8Array(64).fill(128))).toBe(0);
    const square = (amp: number) => Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 128 + amp : 128 - amp));
    expect(micLevel(square(127))).toBe(1);
    expect(micLevel(square(10))).toBeGreaterThan(0);
    expect(micLevel(square(20))).toBeGreaterThan(micLevel(square(10)));
    expect(micLevel(new Uint8Array(0))).toBe(0);
  });
});

describe("matchApp", () => {
  const labels = ["Dashboard", "Attendance", "Student success", "Students", "AI usage"];

  it("prefers a label prefix, then a word prefix, then a substring", () => {
    expect(matchApp(labels, "stu")).toBe(2);
    expect(matchApp(labels, "succ")).toBe(2);
    expect(matchApp(labels, "usa")).toBe(4);
    expect(matchApp(labels, "tend")).toBe(1);
  });

  it("is case-insensitive and returns -1 for blank or unknown queries", () => {
    expect(matchApp(labels, "  DASH ")).toBe(0);
    expect(matchApp(labels, "")).toBe(-1);
    expect(matchApp(labels, "zzz")).toBe(-1);
  });
});

describe("orbState / waveFor", () => {
  it("maps chat status to a state; error wins, then listening", () => {
    expect(orbState({ status: "ready", typing: false, error: false })).toBe("idle");
    expect(orbState({ status: "ready", typing: true, error: false })).toBe("typing");
    expect(orbState({ status: "submitted", typing: true, error: false })).toBe("submitted");
    expect(orbState({ status: "streaming", typing: false, error: false })).toBe("streaming");
    expect(orbState({ status: "ready", typing: false, error: true })).toBe("error");
    expect(orbState({ status: "ready", typing: true, error: false, listening: true })).toBe("listening");
    expect(orbState({ status: "ready", typing: false, error: true, listening: true })).toBe("error");
  });

  it("each state moves the dots its own way: only streaming ripples, thinking contracts and swirls, typing jitters", () => {
    expect(waveFor("idle").amp).toBeGreaterThan(0);
    expect(waveFor("submitted").contract).toBeGreaterThan(0);
    expect(waveFor("submitted").swirl).toBeGreaterThan(0);
    expect(waveFor("typing").jitter).toBeGreaterThan(0);
    for (const s of ["idle", "listening", "streaming", "error"] as const) {
      expect(waveFor(s).contract).toBe(0);
      expect(waveFor(s).jitter).toBe(0);
    }
    expect(waveFor("streaming").ripple).toBeGreaterThan(0);
    for (const s of ["idle", "typing", "submitted", "listening", "error"] as const) expect(waveFor(s).ripple).toBe(0);
    expect(waveFor("submitted").glow).toBeGreaterThan(waveFor("idle").glow);
    expect(waveFor("submitted").spin).toBeGreaterThan(waveFor("idle").spin);
  });

  it("error scatter is brief: starts at rest, bursts, and regroups", () => {
    expect(scatterEnvelope(0)).toBe(0);
    let peak = 0;
    for (let t = 0; t <= 0.5; t += 0.01) peak = Math.max(peak, scatterEnvelope(t));
    expect(peak).toBeGreaterThan(0.6);
    expect(peak).toBeLessThanOrEqual(1);
    expect(scatterEnvelope(2)).toBeLessThan(0.02);
  });
});

describe("dotField", () => {
  it("app dots are well separated for 8, 20 and 35 apps", () => {
    for (const n of [8, 20, 35]) {
      const { apps } = dotField(n, 900);
      expect(apps).toHaveLength(n);
      let min = Infinity;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, angle(apps[i], apps[j]));
      // Ideal spacing for n equal patches is ~sqrt(4*pi/n).
      expect(min).toBeGreaterThan(0.85 * Math.sqrt((4 * Math.PI) / n));
    }
  });

  it("filler dots give the sphere its form even for few apps, and leave each app dot a clearing", () => {
    for (const n of [0, 1, 8, 35]) {
      const { apps, filler } = dotField(n, 900);
      expect(filler.length).toBeGreaterThan(700);
      expect(filler.length).toBeLessThanOrEqual(900);
      for (const f of filler) {
        expect(len(f)).toBeCloseTo(1, 6);
        for (const a of apps) expect(angle(a, f)).toBeGreaterThan(0.08);
      }
      // Form: every octant of the sphere has filler.
      const octants = new Set(filler.map((f) => `${f[0] > 0}${f[1] > 0}${f[2] > 0}`));
      expect(octants.size).toBe(8);
    }
  });
});

describe("pickDot", () => {
  // [x, y, z] per dot: screen px and depth (-1 back .. 1 front).
  const dots = [100, 100, 0.9, 110, 100, 0.5, 300, 300, -0.8, 500, 100, 0.05];

  it("picks the nearest front dot within reach", () => {
    expect(pickDot(dots, 103, 101, 24)).toBe(0);
    expect(pickDot(dots, 109, 100, 24)).toBe(1);
  });

  it("ignores back-hemisphere and edge-on dots, and misses", () => {
    expect(pickDot(dots, 300, 300, 24)).toBe(-1);
    expect(pickDot(dots, 500, 100, 24)).toBe(-1);
    expect(pickDot(dots, 200, 200, 24)).toBe(-1);
    expect(pickDot([], 0, 0, 24)).toBe(-1);
  });
});

describe("frontIndex / frontRotationNear (wheel snap)", () => {
  const pts = fibonacciSphere(37);

  it("frontIndex picks the tile facing the viewer", () => {
    for (const i of [0, 9, 20, 36]) {
      const fr = frontRotation(pts[i]);
      expect(frontIndex(pts, fr.ry, fr.rx)).toBe(i);
    }
    expect(frontIndex([], 0, 0)).toBe(-1);
  });

  it("frontRotationNear brings the tile to +z from any current rotation", () => {
    for (const [ry, rx] of [[0, 0], [2.5, 0.4], [-7, 3.3], [11, -9.2]] as const) {
      const r = frontRotationNear(pts[14], ry, rx);
      const v = rotateYX(pts[14], r.ry, r.rx);
      expect(v[2]).toBeCloseTo(1, 6);
    }
  });

  it("takes the short way: a sphere rolled past the pole is not unwound", () => {
    // Rolled over the top by ~pi: the flipped solution is nearer than the upright one.
    const cur = { ry: 0.3, rx: Math.PI + 0.1 };
    const i = frontIndex(pts, cur.ry, cur.rx);
    const r = frontRotationNear(pts[i], cur.ry, cur.rx);
    expect(Math.abs(r.rx - cur.rx)).toBeLessThan(0.6);
    expect(Math.abs(r.ry - cur.ry)).toBeLessThan(0.9);
  });
});

describe("springStep / coastDistance (wheel momentum)", () => {
  it("settles on the target with a springy overshoot and stays stable at large dt", () => {
    let s = { x: 0, v: 0 };
    let peak = 0;
    for (let t = 0; t < 3; t += 0.05) {
      s = springStep(s.x, s.v, 1, 0.05);
      peak = Math.max(peak, s.x);
    }
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.35);
    expect(s.x).toBeCloseTo(1, 2);
    expect(s.v).toBeCloseTo(0, 1);
  });

  it("keeps incoming velocity (no pop when the snap takes over)", () => {
    const s = springStep(0, 2, 0, 1 / 60);
    expect(s.v).toBeGreaterThan(1.5);
    expect(s.x).toBeGreaterThan(0);
  });

  it("coastDistance is how far exponential friction lets a spin travel", () => {
    expect(coastDistance(3, 2)).toBeCloseTo(1.5, 6);
    expect(coastDistance(-3, 2)).toBeCloseTo(-1.5, 6);
    expect(coastDistance(0, 2)).toBe(0);
  });
});

describe("spinStretch / idleEase", () => {
  it("stretch grows with spin speed and is capped", () => {
    expect(spinStretch(0)).toBe(0);
    expect(spinStretch(2)).toBeGreaterThan(spinStretch(1));
    expect(spinStretch(-2)).toBe(spinStretch(2));
    expect(spinStretch(1000)).toBeLessThanOrEqual(0.3);
  });

  it("idle rotation stays off for 2s after input, then eases in without a jump", () => {
    expect(idleEase(0)).toBe(0);
    expect(idleEase(2)).toBe(0);
    expect(idleEase(2.1)).toBeLessThan(0.05);
    expect(idleEase(2.8)).toBeGreaterThan(0.2);
    expect(idleEase(10)).toBe(1);
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

describe("orbChips", () => {
  const apps = ["/demo/assignments", "/demo/dashboard", "/demo/attendance"];

  it("has a concrete starter prompt for every capability in the catalog", () => {
    const all = orbChips(CAPABILITY_KEYS, { slug: "demo", appHrefs: [], chatOn: true });
    expect(all.length).toBe(CAPABILITY_KEYS.length);
    for (const c of all) {
      expect(c.label.length).toBeGreaterThan(0);
      if (c.kind !== "open") expect(c.prompt?.length ?? 0).toBeGreaterThan(15);
      if (c.kind !== "open") expect(c.prompt).not.toMatch(/^Help me with/);
    }
  });

  it("task capabilities link to the page that runs them when the person can open it", () => {
    const chips = orbChips(["quiz_generator", "daily_briefing"], { slug: "demo", appHrefs: apps, chatOn: true });
    expect(chips.map((c) => [c.kind, c.href])).toEqual([["open", "/demo/assignments"], ["open", "/demo/dashboard"]]);
  });

  it("a task whose page is not in the person's apps falls back to a chat prompt, or is dropped when chat is off", () => {
    expect(orbChips(["enquiry_reply"], { slug: "demo", appHrefs: apps, chatOn: true })[0]).toMatchObject({ kind: "create" });
    expect(orbChips(["enquiry_reply"], { slug: "demo", appHrefs: apps, chatOn: false })).toEqual([]);
  });

  it("chat capabilities are dropped when chat is off; order is ask, create, open", () => {
    expect(orbChips(["attendance_overview"], { slug: "demo", appHrefs: apps, chatOn: false })).toEqual([]);
    const kinds = orbChips(["quiz_generator", "lesson_plan_draft", "attendance_overview"], { slug: "demo", appHrefs: apps, chatOn: true }).map((c) => c.kind);
    expect(kinds).toEqual(["ask", "create", "open"]);
  });
});
