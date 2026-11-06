import { describe, expect, it } from "vitest";
import { activeNavHref, selectBottomNav } from "@/lib/bottom-nav";

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ href: `/p${i}` }));

describe("selectBottomNav", () => {
  it("shows every item without More when 5 or fewer", () => {
    expect(selectBottomNav(mk(2))).toEqual({ primary: mk(2), hasMore: false });
    expect(selectBottomNav(mk(5)).hasMore).toBe(false);
  });
  it("shows first 4 plus More when over 5, keeping priority order", () => {
    const r = selectBottomNav(mk(9));
    expect(r.hasMore).toBe(true);
    expect(r.primary.map((i) => i.href)).toEqual(["/p0", "/p1", "/p2", "/p3"]);
  });
  it("handles an empty list", () => {
    expect(selectBottomNav([])).toEqual({ primary: [], hasMore: false });
  });
});

describe("activeNavHref", () => {
  it("longest prefix wins", () => {
    expect(activeNavHref("/x/exams/rechecks", ["/x/exams", "/x/exams/rechecks"])).toBe("/x/exams/rechecks");
  });
  it("does not match sibling prefixes", () => {
    expect(activeNavHref("/x/examsfoo", ["/x/exams"])).toBeUndefined();
  });
});
