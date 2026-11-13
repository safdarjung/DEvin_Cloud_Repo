// 0148 / D55 — per-page text of a PDF with unpdf (pdf.js serverless build),
// locally, no network. Plain-Node safe (the content.extract job imports it).
import { extractText } from "unpdf";

/** Text of each page, in order (index 0 = page 1). Throws on a file pdf.js cannot open. */
export async function readPdfPages(bytes: Uint8Array): Promise<string[]> {
  // A copy: pdf.js may transfer (detach) the buffer it is given.
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
  return text;
}
