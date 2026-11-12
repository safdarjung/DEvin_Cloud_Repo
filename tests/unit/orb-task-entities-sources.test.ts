import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { entityHasSource } from "@/modules/ai/tasks/entities";
import type { EntityType } from "@/modules/ai/tasks/types";

const COVERED: EntityType[] = [
  "timetable.slot",
  "timetable.substitution",
  "ptm.slot",
  "ptm.booking",
  "schoolLabs.booking",
  "visitors.visit",
  "guardian",
  "visitors.pickupPerson",
];
const UNCOVERED: EntityType[] = ["timetable.period", "messaging.thread", "messaging.counterpart", "announcement", "exam.result", "study.material"];

describe("orb task entity pickers", () => {
  test.each(COVERED)("%s has a picker source", (entity) => {
    expect(entityHasSource(entity)).toBe(true);
  });

  test.each(UNCOVERED)("%s still has no source (no registered owner query)", (entity) => {
    expect(entityHasSource(entity)).toBe(false);
  });
});

describe("card choices", () => {
  test("offers settings-driven and fixed choices instead of typing", async () => {
    const { choicePatches, humanCode } = await import("@/modules/ai/tasks/choices");
    const ctx = { institution: { settings: { admissions: { stages: ["new", "visit_scheduled"] }, exams: { grading_scales: { default: [], cbse_9pt: [] } } } } } as never;
    expect(choicePatches(ctx, "admissions.enquiry.status")["/status"]).toEqual({ kind: "enum", options: ["new", "visit_scheduled"], optionLabels: ["New", "Visit scheduled"] });
    expect(choicePatches(ctx, "exam.create")["/gradingScaleKey"]?.options).toEqual(["default", "cbse_9pt"]);
    expect(choicePatches(ctx, "admissions.enquiry.convert")["/applicant/gender"]?.kind).toBe("enum");
    expect(choicePatches(ctx, "clubs.house.create")["/colour"]?.options?.every((c) => /^#[0-9A-F]{6}$/.test(c))).toBe(true);
    expect(choicePatches(ctx, "inventory.item.create")["/unit"]?.suggestions).toContain("pcs");
    expect(choicePatches(ctx, "unknown.action")).toEqual({});
    expect(humanCode("application_sent")).toBe("Application sent");
  });
});
