import { describe, expect, it } from "vitest";
import { fibonacciSphere, micLevel, orbState, rotateYX, scatterEnvelope, waveFor } from "@/modules/ai/components/orb/orb-layout";
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
