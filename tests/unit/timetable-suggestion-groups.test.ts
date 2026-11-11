import { describe, expect, test } from "vitest";
import { groupSuggestions, visibleCount } from "../../src/modules/timetable/suggestion-groups";
import type { TimetableSuggestion } from "../../src/modules/timetable/suggest";

const sugg = (classSectionId: string, action: string) => ({ action, slot: { classSectionId } }) as unknown as TimetableSuggestion;
const list = [sugg("b", "Put Maths with Rao on Mon P1"), sugg("a", "Put Art with Das on Tue P2"), sugg("b", "Put Hindi with Rao on Mon P3")];
const labels = { a: "Class 10-A", b: "Class 9-B" };

describe("groupSuggestions", () => {
  test("groups by section, sorted by label, keeping original indexes", () => {
    const g = groupSuggestions(list, labels);
    expect(g.map((x) => x.label)).toEqual(["Class 9-B", "Class 10-A"]);
    expect(g[0].items.map((i) => i.index)).toEqual([0, 2]);
  });
  test("section and text filters narrow the groups", () => {
    expect(groupSuggestions(list, labels, { section: "a" })).toHaveLength(1);
    const g = groupSuggestions(list, labels, { text: " rao " });
    expect(g).toHaveLength(1);
    expect(g[0].items).toHaveLength(2);
    expect(groupSuggestions(list, labels, { text: "zzz" })).toEqual([]);
  });
});

describe("visibleCount", () => {
  test("pages of 20, never past the total", () => {
    expect(visibleCount(45, 1)).toBe(20);
    expect(visibleCount(45, 3)).toBe(45);
    expect(visibleCount(5, 1)).toBe(5);
  });
});
