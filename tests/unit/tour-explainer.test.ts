import { describe, expect, test } from "vitest";
import {
  BEAT_FRAMES,
  END_FRAMES,
  EXPLAINER_FPS,
  TITLE_FRAMES,
  explainerTimeline,
} from "../../src/components/tour/explainer/timeline.ts";

describe("explainerTimeline", () => {
  test("duration is title + beats + end card", () => {
    const t = explainerTimeline(5);
    expect(t.durationInFrames).toBe(TITLE_FRAMES + 5 * BEAT_FRAMES + END_FRAMES);
  });

  test("beats are contiguous, start after the title, and end where the end card starts", () => {
    const t = explainerTimeline(6);
    expect(t.beats).toHaveLength(6);
    expect(t.beats[0].from).toBe(TITLE_FRAMES);
    t.beats.forEach((b, i) => {
      if (i > 0) expect(b.from).toBe(t.beats[i - 1].from + t.beats[i - 1].duration);
    });
    const last = t.beats[5];
    expect(last.from + last.duration).toBe(t.end.from);
    expect(t.end.from + t.end.duration).toBe(t.durationInFrames);
  });

  test("zero or negative or fractional counts are clamped to a whole number >= 0", () => {
    expect(explainerTimeline(0).beats).toHaveLength(0);
    expect(explainerTimeline(-3).beats).toHaveLength(0);
    expect(explainerTimeline(2.9).beats).toHaveLength(2);
  });

  test("a 6-feature role stays under 30 seconds", () => {
    expect(explainerTimeline(6).durationInFrames / EXPLAINER_FPS).toBeLessThan(30);
  });
});
