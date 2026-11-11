import { describe, expect, test } from "vitest";
import { suggestTargets } from "@/modules/lifecycle/mapping";

describe("suggestTargets", () => {
  const to = [
    { id: "t6a", name: "A", gradeSortKey: 6 },
    { id: "t6b", name: "B", gradeSortKey: 6 },
    { id: "t7a", name: "A", gradeSortKey: 7 },
  ];
  test("maps to the next grade's same-named section", () => {
    expect(suggestTargets([{ id: "f5b", name: "B", gradeSortKey: 5 }], to)).toEqual({ f5b: "t6b" });
  });
  test("falls back to the first section of the next grade", () => {
    expect(suggestTargets([{ id: "f5c", name: "C", gradeSortKey: 5 }], to)).toEqual({ f5c: "t6a" });
  });
  test("last grade graduates (null)", () => {
    expect(suggestTargets([{ id: "f7a", name: "A", gradeSortKey: 7 }], to)).toEqual({ f7a: null });
  });
});
