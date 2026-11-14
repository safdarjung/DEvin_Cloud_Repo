import { describe, expect, test } from "vitest";
import { ACTS, CLOTH, LANES, SPACING, actAt, buildThreads, problemAt, problemWindow, tangleAt, threadPoint, threadWeave } from "../../src/components/home/loom/weave.ts";
import { PROBLEMS, THREADS } from "../../src/components/home/story.ts";

describe("opening film: yarn layout and timing", () => {
  const threads = buildThreads();

  test("acts cover the whole scroll with no gap or overlap", () => {
    const spans = [ACTS.hero, ACTS.problems, ACTS.weave, ACTS.hold];
    expect(spans[0][0]).toBe(0);
    expect(spans[3][1]).toBe(1);
    for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBe(spans[i - 1][1]);
  });

  test("the cloth has one warp and one weft per lane", () => {
    expect(threads).toHaveLength(LANES * 2);
    for (const kind of [0, 1]) {
      expect(threads.filter((t) => t.kind === kind).map((t) => t.lane).sort((a, b) => a - b)).toEqual(Array.from({ length: LANES }, (_, i) => i));
    }
  });

  test("every problem pulls exactly one weft, in its own thread colour, inside its own card window", () => {
    PROBLEMS.forEach((problem, i) => {
      const pulled = threads.filter((t) => t.problem === i);
      expect(pulled).toHaveLength(1);
      const [th] = pulled;
      expect(th.kind).toBe(1);
      expect(th.color).toBe(THREADS.find((t) => t.key === problem.thread)?.color);
      const [a, b] = problemWindow(i);
      expect(th.start).toBeGreaterThanOrEqual(a);
      expect(th.start + th.dur).toBeLessThanOrEqual(b);
    });
  });

  test("threads that belong to no problem wait for the weave act", () => {
    for (const th of threads.filter((t) => t.problem < 0)) {
      expect(th.start).toBeGreaterThanOrEqual(ACTS.weave[0]);
      expect(th.start + th.dur).toBeLessThanOrEqual(ACTS.weave[1]);
    }
  });

  test("the card on screen follows the scroll: hero, each problem in order, then the weave", () => {
    expect(actAt(0)).toBe("hero");
    expect(problemAt(0)).toBe(-1);
    PROBLEMS.forEach((_, i) => {
      const [a, b] = problemWindow(i);
      expect(problemAt((a + b) / 2)).toBe(i);
    });
    expect(actAt(ACTS.weave[0])).toBe("weave");
    expect(problemAt(ACTS.weave[0])).toBe(-1);
    expect(actAt(1)).toBe("hold");
  });

  test("a woven thread lies straight in its lane and stays inside the cloth", () => {
    for (const th of threads) {
      expect(threadWeave(th, 0)).toBe(0);
      expect(threadWeave(th, 1)).toBe(1);
      const lane = (th.lane - (LANES - 1) / 2) * SPACING;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const [x, y, z] = threadPoint(th, t, 1, 3.7);
        const across = th.kind === 0 ? x : y;
        const along = th.kind === 0 ? y : x;
        expect(across).toBeCloseTo(lane, 6);
        expect(along).toBeCloseTo((t - 0.5) * CLOTH, 6);
        expect(Math.abs(z)).toBeLessThan(0.2);
      }
    }
  });

  test("crossing threads pass over and under each other (plain weave)", () => {
    const warp = threads.find((t) => t.kind === 0 && t.lane === 4)!;
    const weft = threads.find((t) => t.kind === 1 && t.lane === 7)!;
    const half = (LANES - 1) / 2;
    const at = (lane: number) => 0.5 + ((lane - half) * SPACING) / CLOTH;
    const zWarp = threadPoint(warp, at(weft.lane), 1, 0)[2];
    const zWeft = threadPoint(weft, at(warp.lane), 1, 0)[2];
    expect(Math.sign(zWarp)).toBe(-Math.sign(zWeft));
    expect(Math.abs(zWarp - zWeft)).toBeGreaterThan(0.15);
  });

  test("the tangle shrinks and lifts as threads are pulled out of it", () => {
    const start = tangleAt(0);
    const end = tangleAt(ACTS.problems[1]);
    expect(end[0]).toBeLessThan(start[0]);
    expect(end[2]).toBeGreaterThan(start[2]);
  });
});
