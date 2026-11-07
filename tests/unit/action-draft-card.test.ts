// ai-roles P2 — ActionDraftCard has no component-test harness available
// (tests/unit runs under Vitest's "node" environment; no @testing-library
// setup in this repo), so this covers its pure field-editing/serialising
// helpers instead of mounting the component.
import { describe, expect, it } from "vitest";
import {
  formatReadOnlyValue,
  humanizeFieldKey,
  isDraftToolPartType,
  isLongText,
  parseDraftToolOutput,
} from "@/modules/ai/components/ActionDraftCard";

describe("isDraftToolPartType", () => {
  it("matches a kernel draft_* tool part type", () => {
    expect(isDraftToolPartType("tool-draft_curriculum_lessonPlan_upsert")).toBe(true);
  });

  it("matches the existing createTask tool part type", () => {
    expect(isDraftToolPartType("tool-createTask")).toBe(true);
  });

  it("rejects an unrelated tool part type", () => {
    expect(isDraftToolPartType("tool-navigate")).toBe(false);
    expect(isDraftToolPartType("tool-findStudent")).toBe(false);
  });
});

describe("parseDraftToolOutput", () => {
  it("normalizes an action_draft output", () => {
    const result = parseDraftToolOutput({
      kind: "action_draft",
      action: "curriculum.lessonPlan.upsert",
      input: { unitId: "u1", notes: "short" },
      summary: "Draft a lesson plan",
    });
    expect(result).toEqual({
      action: "curriculum.lessonPlan.upsert",
      input: { unitId: "u1", notes: "short" },
      summary: "Draft a lesson plan",
    });
  });

  it("normalizes the existing task_draft output, using note as the summary", () => {
    const result = parseDraftToolOutput({
      kind: "task_draft",
      action: "insight.action",
      input: { insightId: "i1" },
      note: "Draft only. Review it and press Save to record it.",
    });
    expect(result).toEqual({
      action: "insight.action",
      input: { insightId: "i1" },
      summary: "Draft only. Review it and press Save to record it.",
    });
  });

  it("falls back to a generic summary when task_draft has no note", () => {
    const result = parseDraftToolOutput({ kind: "task_draft", action: "insight.action", input: {} });
    expect(result).toEqual({
      action: "insight.action",
      input: {},
      summary: "Review this draft before saving.",
    });
  });

  it("passes a plain-string validation error through untouched", () => {
    expect(parseDraftToolOutput("Task draft invalid: owner")).toEqual({
      error: "Task draft invalid: owner",
    });
  });

  it("returns null for a shape it does not recognize", () => {
    expect(parseDraftToolOutput({ foo: "bar" })).toBeNull();
    expect(parseDraftToolOutput(42)).toBeNull();
    expect(parseDraftToolOutput(null)).toBeNull();
  });
});

describe("humanizeFieldKey", () => {
  it("splits camelCase into words", () => {
    expect(humanizeFieldKey("curriculumUnitId")).toBe("Curriculum unit id");
  });

  it("splits snake_case into words", () => {
    expect(humanizeFieldKey("expected_outcome")).toBe("Expected outcome");
  });

  it("capitalizes a single word", () => {
    expect(humanizeFieldKey("owner")).toBe("Owner");
  });
});

describe("isLongText", () => {
  it("treats short single-line text as short", () => {
    expect(isLongText("Aarav Sharma")).toBe(false);
  });

  it("treats text over 80 chars as long", () => {
    expect(isLongText("a".repeat(81))).toBe(true);
  });

  it("treats multi-line text as long regardless of length", () => {
    expect(isLongText("line one\nline two")).toBe(true);
  });
});

describe("formatReadOnlyValue", () => {
  it("renders null/undefined as an em dash", () => {
    expect(formatReadOnlyValue(null)).toBe("—");
    expect(formatReadOnlyValue(undefined)).toBe("—");
  });

  it("renders booleans as Yes/No", () => {
    expect(formatReadOnlyValue(true)).toBe("Yes");
    expect(formatReadOnlyValue(false)).toBe("No");
  });

  it("renders numbers as-is", () => {
    expect(formatReadOnlyValue(42)).toBe("42");
  });

  it("renders objects/arrays as JSON", () => {
    expect(formatReadOnlyValue({ a: 1 })).toBe('{"a":1}');
    expect(formatReadOnlyValue([1, 2])).toBe("[1,2]");
  });
});
