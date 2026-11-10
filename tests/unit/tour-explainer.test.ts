import { describe, expect, test } from "vitest";
import { TOUR_ROLES } from "../../src/components/tour/roles.ts";
import { SCENE_KEYS, sceneKeyFor } from "../../src/components/tour/explainer/scene-map.ts";
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

  test("there is one cut per section change: into each beat and into the end card", () => {
    const t = explainerTimeline(3);
    expect(t.cuts).toEqual([t.beats[0].from, t.beats[1].from, t.beats[2].from, t.end.from]);
    expect(explainerTimeline(0).cuts).toEqual([TITLE_FRAMES]);
  });

  test("every real role runs between 25 and 40 seconds", () => {
    for (const role of TOUR_ROLES) {
      const seconds = explainerTimeline(role.features.length).durationInFrames / EXPLAINER_FPS;
      expect(seconds, role.key).toBeGreaterThanOrEqual(25);
      expect(seconds, role.key).toBeLessThanOrEqual(40);
    }
  });
});

describe("sceneKeyFor", () => {
  test("every feature in the tour gets a dedicated scene, not the generic one", () => {
    for (const role of TOUR_ROLES) {
      for (const f of role.features) expect(sceneKeyFor(f), `${role.key}: ${f.title}`).not.toBe("generic");
    }
  });

  test("no role shows the same scene twice", () => {
    for (const role of TOUR_ROLES) {
      const keys = role.features.map(sceneKeyFor);
      expect(new Set(keys).size, role.key).toBe(keys.length);
    }
  });

  test("title keywords beat the icon when two features share an icon", () => {
    expect(sceneKeyFor({ title: "Admissions funnel", icon: "ClipboardList" })).toBe("funnel");
    expect(sceneKeyFor({ title: "Admissions pipeline", icon: "ClipboardList" })).toBe("kanban");
    expect(sceneKeyFor({ title: "Scheduled reports", icon: "Bell" })).toBe("reports");
    expect(sceneKeyFor({ title: "Notifications", icon: "Bell" })).toBe("notifications");
    expect(sceneKeyFor({ title: "Attendance alerts", icon: "CalendarCheck" })).toBe("alert");
    expect(sceneKeyFor({ title: "Report cards", icon: "GraduationCap" })).toBe("marks");
  });

  test("an unknown icon and title fall back to the generic scene", () => {
    expect(sceneKeyFor({ title: "Something new", icon: "NoSuchIcon" })).toBe("generic");
    expect(SCENE_KEYS).toContain("generic");
  });
});
