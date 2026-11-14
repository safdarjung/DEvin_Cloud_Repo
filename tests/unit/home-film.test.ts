import { describe, expect, test } from "vitest";
import { PROBLEMS, STORIES } from "../../src/components/home/story.ts";
import { FILM, FILM_FPS, filmTimeline } from "../../src/components/home/film/film-timeline.ts";

describe("filmTimeline", () => {
  test("spans are contiguous from frame 0 to the end, with no gap or overlap", () => {
    expect(FILM.spans[0].from).toBe(0);
    FILM.spans.forEach((s, i) => {
      expect(s.duration).toBeGreaterThan(0);
      if (i > 0) expect(s.from).toBe(FILM.spans[i - 1].from + FILM.spans[i - 1].duration);
    });
    const last = FILM.spans[FILM.spans.length - 1];
    expect(last.from + last.duration).toBe(FILM.durationInFrames);
  });

  test("the film runs 80 to 95 seconds (2400 to 2850 frames at 30 fps)", () => {
    expect(FILM_FPS).toBe(30);
    expect(FILM.durationInFrames).toBeGreaterThanOrEqual(2400);
    expect(FILM.durationInFrames).toBeLessThanOrEqual(2850);
  });

  test("the problems montage has one span per problem and the story one span per step", () => {
    expect(FILM.problems).toHaveLength(PROBLEMS.length);
    expect(FILM.story).toHaveLength(STORIES[0].steps.length);
  });

  test("every section span appears exactly once in the ordered list", () => {
    const named = [FILM.open, ...FILM.problems, FILM.weave, FILM.storyTitle, ...FILM.story, FILM.outcome, FILM.people, FILM.ai, FILM.numbers, FILM.end];
    expect(FILM.spans).toEqual(named);
  });

  test("there is one cut per section change, and none inside the montage", () => {
    const sections = [FILM.problems[0], FILM.weave, FILM.storyTitle, ...FILM.story, FILM.outcome, FILM.people, FILM.ai, FILM.numbers, FILM.end];
    expect(FILM.cuts).toEqual(sections.map((s) => s.from));
  });

  test("counts are clamped to whole numbers >= 0", () => {
    expect(filmTimeline(-2, 2.7).problems).toHaveLength(0);
    expect(filmTimeline(-2, 2.7).story).toHaveLength(2);
  });
});
