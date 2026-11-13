import { describe, expect, it } from "vitest";
import {
  CHUNK_TARGET_CHARS,
  canExtractText,
  chunkPages,
  cleanText,
  detectChapter,
  needsOcr,
  splitLong,
} from "@/modules/content/chunker";

describe("rights gate", () => {
  it("reads only school-owned, licensed and open-licence custom books", () => {
    expect(canExtractText({ rights_status: "school_owned", ncert_code: null })).toBe(true);
    expect(canExtractText({ rights_status: "licensed", ncert_code: null })).toBe(true);
    expect(canExtractText({ rights_status: "open_licence", ncert_code: null })).toBe(true);
    expect(canExtractText({ rights_status: "unknown", ncert_code: null })).toBe(false);
    expect(canExtractText({ rights_status: "link_only", ncert_code: null })).toBe(false);
  });

  it("never reads an NCERT book, whatever its status claims", () => {
    expect(canExtractText({ rights_status: "school_owned", ncert_code: "fesc1" })).toBe(false);
  });
});

describe("cleanText (garbage in)", () => {
  it("drops NUL and control characters, lone surrogates and replacement chars", () => {
    const raw = "Pho\u0000to\u0007syn\uFFFDthesis \uD800 is\u000Bfun";
    expect(cleanText(raw)).toBe("Photosynthesis is fun");
  });

  it("collapses spaces and keeps at most one blank line", () => {
    expect(cleanText("a   b\r\n\r\n\r\n\r\nc \n d")).toBe("a b\n\nc\nd");
  });

  it("returns empty for whitespace-only input", () => {
    expect(cleanText(" \n\t \n")).toBe("");
  });
});

describe("needsOcr", () => {
  it("flags a page with no or near-empty text layer", () => {
    expect(needsOcr("")).toBe(true);
    expect(needsOcr("12")).toBe(true);
    expect(needsOcr("— · — 7 —")).toBe(true);
  });

  it("keeps a page with real text", () => {
    expect(needsOcr("Plants make their own food by photosynthesis.")).toBe(false);
  });
});

describe("splitLong", () => {
  it("keeps a short page whole", () => {
    expect(splitLong("one paragraph")).toEqual(["one paragraph"]);
  });

  it("splits a long page at paragraph/line boundaries, each piece within the target", () => {
    const para = "Sentence about cells. ".repeat(30).trim(); // ~660 chars
    const text = [para, para, para, para].join("\n\n");
    const parts = splitLong(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(CHUNK_TARGET_CHARS);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("hard-cuts a single run-on line with no boundaries", () => {
    const parts = splitLong("x".repeat(4000));
    expect(parts.map((p) => p.length)).toEqual([1500, 1500, 1000]);
  });
});

describe("detectChapter", () => {
  it("reads 'Chapter N' headings and their title", () => {
    expect(detectChapter("Chapter 3\nMotion and Rest\nbody", {})).toEqual({ chapterNo: 3, heading: "Chapter 3" });
    expect(detectChapter("CHAPTER 2: Forces\nbody", {})).toEqual({ chapterNo: 2, heading: "Forces" });
    expect(detectChapter("Unit 4 – Fractions", {})).toEqual({ chapterNo: 4, heading: "Fractions" });
  });

  it("prefers the school's own chapter title when it has one", () => {
    expect(detectChapter("Chapter 3\nbody", { "3": "Light" })).toEqual({ chapterNo: 3, heading: "Light" });
  });

  it("matches numbered headings only against known chapter titles", () => {
    expect(detectChapter("5. The Living World\ntext", { "5": "The Living World" })).toEqual({ chapterNo: 5, heading: "The Living World" });
    expect(detectChapter("5. Find the value of x\ntext", { "5": "The Living World" })).toBeNull();
    expect(detectChapter("5. The Living World\ntext", {})).toBeNull();
  });

  it("ignores a chapter mention deep in the page", () => {
    const text = ["a line", "b line", "c line", "d line", "e line", "f line", "see Chapter 9"].join("\n");
    expect(detectChapter(text, {})).toBeNull();
  });
});

describe("chunkPages", () => {
  it("chunks by page and carries the chapter forward until the next heading", () => {
    const chunks = chunkPages(
      [
        { page: 1, text: "Contents\nPreface text here for the book." },
        { page: 2, text: "Chapter 1\nCells are the units of life." },
        { page: 3, text: "More about cells and tissues." },
        { page: 4, text: "Chapter 2 Plants\nPlants make food." },
      ],
      { "1": "Cell Structure" },
    );
    expect(chunks.map((c) => [c.page_from, c.page_to, c.chapter_no, c.heading])).toEqual([
      [1, 1, null, null],
      [2, 2, 1, "Cell Structure"],
      [3, 3, 1, "Cell Structure"],
      [4, 4, 2, "Plants"],
    ]);
  });

  it("skips empty pages and starts from a given chapter (OCR batches)", () => {
    const chunks = chunkPages([{ page: 7, text: "  " }, { page: 8, text: "Roots hold the soil." }], {}, { chapterNo: 4, heading: "Soil" });
    expect(chunks).toEqual([{ chapter_no: 4, page_from: 8, page_to: 8, heading: "Soil", body: "Roots hold the soil." }]);
  });
});
