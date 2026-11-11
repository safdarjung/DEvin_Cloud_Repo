import { describe, expect, test } from "vitest";
import { clipText, MAX_NUDGES, MAX_TEXT, rankNudges, type Nudge } from "@/modules/ai/nudges";

const n = (id: string, kind: Nudge["kind"], text = `text of ${id}`): Nudge => ({ id, kind, text, href: "/x", ask: "q" });

describe("rankNudges", () => {
  test("orders alerts before suggestions before insights, stable within a kind", () => {
    const out = rankNudges([n("i1", "insight"), n("s1", "suggestion"), n("a1", "alert"), n("a2", "alert")]);
    expect(out.map((x) => x.id)).toEqual(["a1", "a2", "s1", "i1"]);
  });

  test("drops duplicate ids, keeping the first", () => {
    const out = rankNudges([n("a", "insight", "first"), n("a", "alert", "second")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.text).toBe("first");
  });

  test("caps the list at 8", () => {
    const many = Array.from({ length: 12 }, (_, i) => n(`s${i}`, "suggestion"));
    expect(rankNudges(many)).toHaveLength(MAX_NUDGES);
  });

  test("truncates text to 110 characters with an ellipsis", () => {
    const out = rankNudges([n("a", "alert", "x".repeat(300))]);
    expect(out[0]?.text).toHaveLength(MAX_TEXT);
    expect(out[0]?.text.endsWith("…")).toBe(true);
  });
});

describe("clipText", () => {
  test("collapses whitespace and leaves short text alone", () => {
    expect(clipText("  two   words \n")).toBe("two words");
  });

  test("rankNudges shows a sentence once when two different rows produce the same text", () => {
    const a = { id: "insight:1", kind: "alert" as const, text: "Learning gaps need support", href: "/x", ask: "?" };
    const b = { ...a, id: "insight:2" };

    const ranked = rankNudges([a, b]);

    expect(ranked.map((n) => n.id)).toEqual(["insight:1"]);
  });
});
