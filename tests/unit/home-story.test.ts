import { describe, expect, test } from "vitest";
import { MODULES } from "../../src/lib/modules/catalog.ts";
import { ROLE_PERMISSIONS } from "../../src/lib/auth/permissions.ts";
import { CAPABILITY_KEYS } from "../../src/modules/ai/capabilities/catalog.ts";
import { STUDENT_LANGUAGES } from "../../src/modules/ai/prompts/student-skills.ts";
import { HOME_STATS } from "../../src/components/home/stats.ts";
import { HONESTY_TEXT, PEOPLE, PROBLEMS, STORIES, THREADS, type HonestyLabel } from "../../src/components/home/story.ts";
import { TOUR_ROLES } from "../../src/components/tour/roles.ts";
import { SCENE_KEYS } from "../../src/components/tour/explainer/scene-map.ts";
import { resolveIcon } from "../../src/components/tour/explainer/icon.tsx";
import { Sparkles } from "lucide-react";
import { explainerTimeline } from "../../src/components/tour/explainer/timeline.ts";
import { storyTimeline } from "../../src/components/home/film/StoryExplainer.tsx";

const steps = STORIES.flatMap((s) => s.steps.map((st) => ({ story: s.key, ...st })));

describe("story content", () => {
  test("every step scene is a known scene key", () => {
    for (const s of steps) expect(SCENE_KEYS as readonly string[], `${s.story}/${s.title}`).toContain(s.scene);
  });
  test("every step icon resolves to a real lucide icon", () => {
    for (const s of steps) if (s.icon !== "Sparkles") expect(resolveIcon(s.icon), `${s.story}/${s.title}`).not.toBe(Sparkles);
  });
  test("titles and blurbs fit the film", () => {
    for (const s of steps) {
      expect(s.title.length, s.title).toBeLessThanOrEqual(28);
      expect(s.blurb.length, s.blurb).toBeLessThanOrEqual(100);
    }
  });
  test("each story has 5 steps and a known thread", () => {
    const threads = THREADS.map((t) => t.key);
    for (const s of STORIES) {
      expect(s.steps).toHaveLength(5);
      expect(threads).toContain(s.thread);
    }
  });
  test("problems cover every thread exactly once", () => {
    expect(PROBLEMS.map((p) => p.thread).sort()).toEqual(THREADS.map((t) => t.key).sort());
  });
  test("every person maps to a real tour role", () => {
    const keys = TOUR_ROLES.map((r) => r.key);
    for (const p of Object.values(PEOPLE)) expect(keys).toContain(p.tour);
  });
  test("simulated and test-mode blurbs carry the matching label", () => {
    for (const s of steps) {
      for (const l of ["simulated", "test mode"] as HonestyLabel[]) {
        if (s.blurb.toLowerCase().includes(l)) expect(s.label, `${s.story}/${s.title}`).toBe(l);
      }
      if (s.label) expect(HONESTY_TEXT[s.label]).toBeTruthy();
    }
  });
});

describe("HOME_STATS", () => {
  test("match their real sources", () => {
    expect(HOME_STATS.modules).toBe(Object.keys(MODULES).length);
    expect(HOME_STATS.categories).toBe(new Set(Object.values(MODULES).map((m) => m.category)).size);
    expect(HOME_STATS.roles).toBe(Object.keys(ROLE_PERMISSIONS).length);
    expect(HOME_STATS.aiSkills).toBe(CAPABILITY_KEYS.length);
    expect(HOME_STATS.studyLanguages).toBe(STUDENT_LANGUAGES.length);
  });
});

describe("story timeline", () => {
  test("duration equals the explainer timeline for 5 steps", () => {
    expect(storyTimeline(STORIES[0]).durationInFrames).toBe(explainerTimeline(5).durationInFrames);
  });
});
