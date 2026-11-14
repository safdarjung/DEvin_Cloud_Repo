import { describe, expect, it } from "vitest";
import { burstParticles, constellationPath, pickSurprise } from "@/modules/ai/components/orb/orb-play";

describe("surprise pick", () => {
  it("never repeats the last pick while another choice exists", () => {
    const keys = ["a", "b", "c"];
    for (const r of [0, 0.34, 0.5, 0.99]) expect(pickSurprise(keys, "b", () => r)).not.toBe("b");
  });
  it("covers every other choice and handles one or none", () => {
    const keys = ["a", "b", "c", "d"];
    const seen = new Set([0, 0.26, 0.51, 0.76, 0.99].map((r) => pickSurprise(keys, "a", () => r)));
    expect(seen).toEqual(new Set(["b", "c", "d"]));
    expect(pickSurprise(["only"], "only", () => 0.5)).toBe("only");
    expect(pickSurprise([], null, () => 0.5)).toBeNull();
  });
});

describe("burst particles", () => {
  it("spreads n particles all round the circle, the same for the same seed", () => {
    const ps = burstParticles(12, 7);
    expect(ps).toHaveLength(12);
    expect(burstParticles(12, 7)).toEqual(ps);
    // Every quadrant gets some.
    const quads = new Set(ps.map((p) => `${Math.sign(p.dx)}${Math.sign(p.dy)}`));
    expect(quads.size).toBe(4);
    for (const p of ps) {
      const d = Math.hypot(p.dx, p.dy);
      expect(d).toBeGreaterThan(0.5);
      expect(d).toBeLessThanOrEqual(1.0001);
      expect(p.size).toBeGreaterThan(0);
      expect(p.delay).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("constellation path", () => {
  it("draws one line from the hot dot to each kin dot, nothing without kin", () => {
    expect(constellationPath([0, 0], [])).toBe("");
    expect(constellationPath([1, 2], [[3, 4], [-5, 6.25]])).toBe("M1.0 2.0L3.0 4.0M1.0 2.0L-5.0 6.3");
  });
});
