// 0148 — content.extract: one textbook PDF -> content_chunks (Phase 2 of
// 15-learning-exam-system-plan.md; D55). Text pages are read locally with
// unpdf; pages without a text layer are only listed (needs_ocr_pages): OCR
// needs the AI gateway, which runs in the app with the user's own context
// (content/actions.ts), never from this plain-Node job.
// Relative `.ts` value imports; `@/` only for types.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/db/types";
import { MAX_PDF_PAGES, canExtractText, chapterTitlesOf, chunkPages, cleanText, needsOcr, type PageText } from "../../content/chunker.ts";
import { readPdfPages } from "../../content/pdf-text.ts";
import type { JobHandler } from "../types.ts";

const PayloadSchema = z.object({ extractionId: z.string().uuid() });
const BUCKET = "tenant-docs";

async function markFailed(admin: SupabaseClient<Database>, id: string, error: string): Promise<void> {
  const { error: updateError } = await admin
    .from("content_extractions")
    .update({ status: "failed", error: error.slice(0, 500), finished_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) throw new Error(updateError.message);
}

/** Page texts split into readable pages and pages needing OCR. */
export function splitPages(pages: readonly string[]): { textPages: PageText[]; needsOcrPages: number[] } {
  const textPages: PageText[] = [];
  const needsOcrPages: number[] = [];
  pages.forEach((raw, i) => {
    const text = cleanText(raw);
    if (needsOcr(text)) needsOcrPages.push(i + 1);
    else textPages.push({ page: i + 1, text });
  });
  return { textPages, needsOcrPages };
}

export const contentExtract: JobHandler = async (job, { admin }) => {
  const { extractionId } = PayloadSchema.parse(job.payload);
  const { data: run, error } = await admin
    .from("content_extractions")
    .select("id, institution_id, status, document_id, subject_textbook_id")
    .eq("id", extractionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // Gone, another school's id, or already finished by an earlier run of this job.
  if (!run || run.institution_id !== job.institution_id || run.status === "done" || run.status === "partial") return;

  // Re-checked at run time: rights or the file may have changed since the start.
  const { data: book, error: bookError } = await admin
    .from("subject_textbooks")
    .select("rights_status, ncert_code, chapter_titles")
    .eq("id", run.subject_textbook_id)
    .maybeSingle();
  if (bookError) throw new Error(bookError.message);
  if (!book || !canExtractText(book)) return markFailed(admin, run.id, "This book's rights status does not allow storing its text.");

  const { data: doc, error: docError } = await admin.from("documents").select("path, status, mime").eq("id", run.document_id).maybeSingle();
  if (docError) throw new Error(docError.message);
  if (!doc || doc.status !== "active" || doc.mime !== "application/pdf") {
    return markFailed(admin, run.id, "The book's PDF was removed or replaced. Start a new reading.");
  }

  const { error: startError } = await admin
    .from("content_extractions")
    .update({ status: "running", started_at: new Date().toISOString(), error: null })
    .eq("id", run.id);
  if (startError) throw new Error(startError.message);

  try {
    const { data: blob, error: downloadError } = await admin.storage.from(BUCKET).download(doc.path);
    if (downloadError || !blob) throw new Error("storage download failed");

    let pages: string[];
    try {
      pages = await readPdfPages(new Uint8Array(await blob.arrayBuffer()));
    } catch {
      return await markFailed(admin, run.id, "This file could not be read as a PDF.");
    }
    if (pages.length === 0) return await markFailed(admin, run.id, "This PDF has no pages.");
    if (pages.length > MAX_PDF_PAGES) return await markFailed(admin, run.id, `This PDF has more than ${MAX_PDF_PAGES} pages. Upload it in parts.`);

    const { textPages, needsOcrPages } = splitPages(pages);
    const chunks = chunkPages(textPages, chapterTitlesOf(book.chapter_titles));
    const { error: saveError } = await admin.rpc("save_content_extraction", {
      p_extraction_id: run.id,
      p_pages_total: pages.length,
      p_needs_ocr: needsOcrPages,
      p_chunks: chunks as unknown as Database["public"]["Functions"]["save_content_extraction"]["Args"]["p_chunks"],
    });
    if (saveError) throw new Error(saveError.message);
  } catch (err) {
    // Visible on the book while the runner retries (and after the last try).
    await markFailed(admin, run.id, "Reading this book failed. It will be retried.");
    throw err;
  }
};
