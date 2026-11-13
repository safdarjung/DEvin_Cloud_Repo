import { describe, expect, it } from "vitest";
import { chunkPages, cleanText, needsOcr } from "@/modules/content/chunker";
import { readPdfPages } from "@/modules/content/pdf-text";
import { tinyPdf } from "../helpers/tiny-pdf";

describe("readPdfPages (unpdf)", () => {
  it("reads each page's text layer and leaves a scan-like page empty", async () => {
    const pages = await readPdfPages(
      tinyPdf([["Chapter 1 Cells", "Cells are the basic units of life in every plant and animal."], [], ["Mitochondria release energy from food (respiration)."]]),
    );
    expect(pages).toHaveLength(3);
    expect(cleanText(pages[0])).toContain("Chapter 1 Cells");
    expect(needsOcr(cleanText(pages[1]))).toBe(true);
    expect(cleanText(pages[2])).toContain("Mitochondria release energy from food (respiration).");

    const chunks = chunkPages(pages.map((text, i) => ({ page: i + 1, text })).filter((p) => !needsOcr(cleanText(p.text))));
    expect(chunks.map((c) => [c.page_from, c.chapter_no])).toEqual([
      [1, 1],
      [3, 1],
    ]);
  });

  it("rejects bytes that are not a PDF (garbage in)", async () => {
    await expect(readPdfPages(new TextEncoder().encode("not a pdf at all"))).rejects.toThrow();
  });
});
