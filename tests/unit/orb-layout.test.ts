import { describe, expect, it } from "vitest";
import {
  dotLook, dotPoints, dotSize, easeOutBack, fibonacciSphere, flickDelta, frontAngle, frontTilt, idleEase, micLevel, nearestAngle,
  netPaths, nudgeAway, orbNet, orbState, pointerDir, rotateYX, scatterEnvelope, shockAt, springStep, stepIndex, typingPulse, waveFor,
} from "@/modules/ai/components/orb/orb-layout";
import { orbChips } from "@/modules/ai/components/orb/orb-chips";
import { CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";

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

  it("task states: a card leaving wins over answering, done over typing, and waiting only when nothing else is going on", () => {
    expect(orbState({ status: "streaming", typing: false, error: false, proposing: true })).toBe("proposing");
    expect(orbState({ status: "ready", typing: true, error: false, done: true })).toBe("done");
    expect(orbState({ status: "ready", typing: true, error: false, waiting: true })).toBe("typing");
    expect(orbState({ status: "ready", typing: false, error: false, waiting: true })).toBe("waiting");
    expect(orbState({ status: "submitted", typing: false, error: false, waiting: true })).toBe("submitted");
    expect(orbState({ status: "ready", typing: false, error: true, proposing: true })).toBe("error");
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

describe("flick-to-mode snapping", () => {
  it("a small or slow nudge stays on the current mode", () => {
    expect(flickDelta(0, 0)).toBe(0);
    expect(flickDelta(10, 0)).toBe(0);
    expect(flickDelta(-15, -100)).toBe(0);
  });

  it("a deliberate drag moves one mode: left is next, right is previous", () => {
    expect(flickDelta(-40, 0)).toBe(1);
    expect(flickDelta(40, 0)).toBe(-1);
  });

  it("a quick flick coasts with inertia (short drag, high speed) but never more than two modes", () => {
    expect(flickDelta(-10, -500)).toBe(1);
    expect(flickDelta(-150, -400)).toBe(1);
    expect(flickDelta(-100, -2000)).toBe(2);
    expect(flickDelta(20, 3000)).toBe(-2);
    expect(flickDelta(-400, -4000)).toBe(2);
  });

  it("steps wrap both ways", () => {
    expect(stepIndex(5, 1, 6)).toBe(0);
    expect(stepIndex(0, -1, 6)).toBe(5);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });

  it("typing energy rises with each key and is capped", () => {
    let p = 0;
    for (let i = 0; i < 3; i++) p = typingPulse(p);
    expect(p).toBeCloseTo(1.05, 9);
    for (let i = 0; i < 20; i++) p = typingPulse(p);
    expect(p).toBe(1.6);
  });
});

describe("turning a dot to the front", () => {
  it("nearestAngle picks the equivalent angle closest to the current one", () => {
    expect(nearestAngle(0, 0.5)).toBeCloseTo(0.5, 9);
    expect(nearestAngle(10 * Math.PI, 0.5)).toBeCloseTo(10 * Math.PI + 0.5, 9);
    expect(nearestAngle(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(-0.1, 9);
  });
});

describe("spin physics", () => {
  it("the snap spring settles with a small overshoot and stays stable at large dt", () => {
    let s = { x: 0, v: 0 };
    let peak = 0;
    for (let t = 0; t < 3; t += 0.05) {
      s = springStep(s.x, s.v, 1, 0.05);
      peak = Math.max(peak, s.x);
    }
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.35);
    expect(s.x).toBeCloseTo(1, 2);
  });

  it("the spring keeps incoming velocity, so a fling hands over to the snap without a pop", () => {
    const s = springStep(0, 2, 0, 1 / 60);
    expect(s.v).toBeGreaterThan(1.5);
    expect(s.x).toBeGreaterThan(0);
  });

  it("idle spin stays off for 2 s after input, then eases in without a jump", () => {
    expect(idleEase(0)).toBe(0);
    expect(idleEase(2)).toBe(0);
    expect(idleEase(2.1)).toBeLessThan(0.05);
    expect(idleEase(2.8)).toBeGreaterThan(0.2);
    expect(idleEase(10)).toBe(1);
  });
});

describe("nudgeAway / easeOutBack (hover part, fly-in)", () => {
  const h: [number, number, number] = [0, 0, 1];
  const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  it("a near neighbour turns away from the hovered section, more when closer; far ones stay", () => {
    const near: [number, number, number] = [Math.sin(0.5), 0, Math.cos(0.5)];
    const nearer: [number, number, number] = [Math.sin(0.3), 0, Math.cos(0.3)];
    const q = nudgeAway(near, h, 0.2);
    expect(len(q)).toBeCloseTo(1, 9);
    expect(dot(q, h)).toBeLessThan(dot(near, h));
    expect(q[1]).toBeCloseTo(0, 9);
    const moved = (p: readonly number[]) => Math.acos(dot(nudgeAway(p as [number, number, number], h, 0.2), p));
    expect(moved(nearer)).toBeGreaterThan(moved(near));
    expect(nudgeAway([1, 0, 0], h, 0.2)).toEqual([1, 0, 0]);
  });

  it("leaves the hovered section itself and a zero-strength part alone", () => {
    expect(nudgeAway(h, h, 0.2)).toBe(h);
    const p: [number, number, number] = [Math.sin(0.4), 0, Math.cos(0.4)];
    expect(nudgeAway(p, h, 0)).toBe(p);
  });

  it("easeOutBack starts at 0, ends at 1 and overshoots a little on the way", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 9);
    expect(easeOutBack(1)).toBe(1);
    expect(easeOutBack(2)).toBe(1);
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map(easeOutBack))).toBeGreaterThan(1);
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

describe("orbNet", () => {
  it("is a closed honeycomb: 20f² joints on the unit sphere, 30f² links, three links at every joint", () => {
    for (const f of [1, 2, 4]) {
      const net = orbNet(f);
      expect(net.points).toHaveLength(20 * f * f);
      expect(net.links).toHaveLength(30 * f * f);
      for (const p of net.points) expect(len(p)).toBeCloseTo(1, 6);
      const degree = net.points.map(() => 0);
      for (const [a, b] of net.links) {
        expect(a).not.toBe(b);
        degree[a]++;
        degree[b]++;
      }
      expect(new Set(degree)).toEqual(new Set([3]));
    }
  });

  it("has links of nearly one length, so the net reads as even cells", () => {
    const net = orbNet(4);
    const lengths = net.links.map(([a, b]) => dist(net.points[a], net.points[b]));
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.6);
  });

  it("draws the near and far halves as separate paths that turn with the pose", () => {
    const net = orbNet(2);
    const still = netPaths(net, 0, 0, 100);
    const count = (d: string) => d.split("M").length - 1;
    expect(count(still.near) + count(still.far)).toBe(net.links.length);
    expect(count(still.near)).toBeGreaterThan(0);
    expect(count(still.far)).toBeGreaterThan(0);
    expect(netPaths(net, 0.4, 0.2, 100).near).not.toBe(still.near);
    // Every coordinate stays inside the circle of the given radius.
    for (const n of still.near.match(/-?\d+(\.\d+)?/g) ?? []) expect(Math.abs(Number(n))).toBeLessThanOrEqual(100);
  });
});

describe("shockAt", () => {
  it("is silent before it starts and long after", () => {
    expect(shockAt(-0.5).strength).toBe(0);
    expect(shockAt(3).strength).toBeLessThan(0.02);
  });

  it("starts at the front pole at full strength and crosses the whole sphere while fading", () => {
    expect(shockAt(0)).toEqual({ front: 0, strength: 1 });
    const mid = shockAt(0.5);
    expect(mid.front).toBeGreaterThan(0);
    expect(mid.strength).toBeLessThan(1);
    expect(shockAt(1.2).front).toBeGreaterThanOrEqual(Math.PI);
    expect(shockAt(1.2).strength).toBeGreaterThan(0.05);
  });
});

describe("pointerDir", () => {
  it("maps the middle of the orb to the front pole", () => {
    expect(pointerDir(0, 0)).toEqual([0, 0, 1]);
  });

  it("returns a unit vector on the front hemisphere, also for a pointer outside the orb", () => {
    for (const [x, y] of [[0.3, -0.4], [1, 0], [3, 4], [-0.7, 0.7]]) {
      const d = pointerDir(x, y);
      expect(len(d)).toBeCloseTo(1, 6);
      expect(d[2]).toBeGreaterThanOrEqual(0);
    }
    expect(pointerDir(3, 4)[0]).toBeCloseTo(0.6, 6);
  });
});

describe("feature dots on the sphere", () => {
  it("frontAngle then frontTilt bring any point to the front", () => {
    for (const v of fibonacciSphere(40)) {
      const out = rotateYX(v, frontAngle(v), frontTilt(v));
      expect(out[0]).toBeCloseTo(0, 6);
      expect(out[1]).toBeCloseTo(0, 6);
      expect(out[2]).toBeCloseTo(1, 6);
    }
  });

  it("dots at every count are spread evenly over the whole sphere, back included", () => {
    expect(dotPoints(0)).toEqual([]);
    expect(dotPoints(1)).toEqual([[0, 0, 1]]);
    for (let n = 2; n <= 30; n++) {
      const pts = dotPoints(n);
      expect(pts).toHaveLength(n);
      for (const p of pts) expect(len(p)).toBeCloseTo(1, 6);
      let nearest = Infinity;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) nearest = Math.min(nearest, dist(pts[i], pts[j]));
      // Even spacing: the closest pair is not far below the spacing of n equal patches of the sphere.
      expect(nearest).toBeGreaterThan(0.75 * Math.sqrt((4 * Math.PI) / n) * (n <= 4 ? 1 : 0.95));
      if (n >= 4) expect(pts.some((p) => p[2] < -0.3)).toBe(true);
    }
    // Same answer every time (cached), and a caller cannot change the cached points.
    const a = dotPoints(7);
    (a[0] as unknown as number[])[0] = 99;
    expect(dotPoints(7)[0][0]).not.toBe(99);
  });

  it("many dots cover the whole sphere", () => {
    const many = dotPoints(60);
    expect(many).toHaveLength(60);
    expect(many.some((p) => p[2] < -0.8)).toBe(true);
    expect(many.some((p) => p[1] > 0.9)).toBe(true);
  });

  it("dots grow and brighten toward the front, and only near-front ones take a click", () => {
    expect(dotLook(1).scale).toBeCloseTo(1, 6);
    expect(dotLook(-1).scale).toBeLessThan(0.4);
    expect(dotLook(1).opacity).toBeGreaterThan(dotLook(0).opacity);
    expect(dotLook(-1).pickable).toBe(false);
    expect(dotLook(0).pickable).toBe(false);
    expect(dotLook(0.9).pickable).toBe(true);
    // A pickable dot is never much smaller than its full size.
    for (let z = -1; z <= 1; z += 0.05) if (dotLook(z).pickable) expect(dotLook(z).scale).toBeGreaterThan(0.85);
  });

  it("dot size shrinks with the count and stays within its limits", () => {
    expect(dotSize(150, 4)).toBe(46);
    expect(dotSize(150, 70)).toBeLessThan(dotSize(150, 30));
    expect(dotSize(60, 200)).toBe(22);
    expect(dotSize(150, 0)).toBe(46);
  });
});
