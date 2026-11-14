import { describe, expect, test } from "vitest";
import { deckReducer, formatHash, parseHash, type DeckPos } from "../../src/components/present/deck-nav.ts";
import { SLIDES } from "../../src/components/present/slide-meta.ts";
import { STORIES } from "../../src/components/home/story.ts";

// Three slides: the middle one has two fragments (steps revealed one at a time).
const FRAGS = [0, 2, 0] as const;
const at = (slide: number, step = 0): DeckPos => ({ slide, step });

describe("deckReducer", () => {
  test("next moves to the following slide when the current one has no fragments", () => {
    expect(deckReducer(FRAGS, at(0), { type: "next" })).toEqual(at(1, 0));
  });

  test("next reveals fragments one at a time before leaving the slide", () => {
    expect(deckReducer(FRAGS, at(1, 0), { type: "next" })).toEqual(at(1, 1));
    expect(deckReducer(FRAGS, at(1, 1), { type: "next" })).toEqual(at(1, 2));
    expect(deckReducer(FRAGS, at(1, 2), { type: "next" })).toEqual(at(2, 0));
  });

  test("prev hides fragments one at a time, then returns to the previous slide fully revealed", () => {
    expect(deckReducer(FRAGS, at(1, 2), { type: "prev" })).toEqual(at(1, 1));
    expect(deckReducer(FRAGS, at(1, 0), { type: "prev" })).toEqual(at(0, 0));
    expect(deckReducer(FRAGS, at(2, 0), { type: "prev" })).toEqual(at(1, 2));
  });

  test("next and prev clamp at the ends", () => {
    expect(deckReducer(FRAGS, at(2, 0), { type: "next" })).toEqual(at(2, 0));
    expect(deckReducer(FRAGS, at(0, 0), { type: "prev" })).toEqual(at(0, 0));
  });

  test("first, last and goto land on step 0, and goto clamps out-of-range slides", () => {
    expect(deckReducer(FRAGS, at(1, 2), { type: "first" })).toEqual(at(0, 0));
    expect(deckReducer(FRAGS, at(0, 0), { type: "last" })).toEqual(at(2, 0));
    expect(deckReducer(FRAGS, at(0, 0), { type: "goto", slide: 1 })).toEqual(at(1, 0));
    expect(deckReducer(FRAGS, at(0, 0), { type: "goto", slide: 99 })).toEqual(at(2, 0));
    expect(deckReducer(FRAGS, at(2, 0), { type: "goto", slide: -4 })).toEqual(at(0, 0));
  });
});

describe("slide hash", () => {
  test("format and parse round-trip for every slide", () => {
    for (let i = 0; i < SLIDES.length; i++) expect(parseHash(formatHash(i), SLIDES.length)).toBe(i);
  });

  test("hash is one-based, like the on-screen counter", () => {
    expect(formatHash(0)).toBe("#1");
    expect(parseHash("#3", 10)).toBe(2);
  });

  test("missing, malformed or out-of-range hashes fall back or clamp", () => {
    expect(parseHash("", 10)).toBe(0);
    expect(parseHash("#", 10)).toBe(0);
    expect(parseHash("#abc", 10)).toBe(0);
    expect(parseHash("#0", 10)).toBe(0);
    expect(parseHash("#-2", 10)).toBe(0);
    expect(parseHash("#42", 10)).toBe(9);
  });
});

describe("slide list", () => {
  test("every slide has a title and two to four sentences of speaker notes", () => {
    for (const s of SLIDES) {
      expect(s.title.length).toBeGreaterThan(0);
      const sentences = s.notes.split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length, s.id).toBeGreaterThanOrEqual(2);
      expect(sentences.length, s.id).toBeLessThanOrEqual(4);
    }
  });

  test("story slides reveal one fragment per step", () => {
    for (const key of ["absent", "fees", "results"]) {
      const slide = SLIDES.find((s) => s.story === key);
      const story = STORIES.find((s) => s.key === key);
      expect(slide?.frags).toBe(story?.steps.length);
    }
  });
});
