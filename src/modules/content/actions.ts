"use server";

// 0148 — content.extraction.* / content.chunk.update (Phase 2 of
// 15-learning-exam-system-plan.md). Gate: resource.manage (same as the
// textbook file, files.actions.ts); RLS/definer RPCs decide which books
// (leaders; the grade+subject's teacher). Start re-checks the rights gate in
// SQL; NCERT rows are link-only and never read.
//
// The text pass is the content.extract job (unpdf, no AI), run in this
// request when it fits (same in-request pattern as workflows/actions.ts),
// else by the job runner. Pages with no text layer are OCR'd only through
// ocrExtractionPages: the AI gateway with the caller's own context (quota,
// role cloud switch), never under local_only (they stay 'needs OCR').
import { createHash } from "node:crypto";
import { z } from "zod";
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { runStructuredFile } from "@/lib/ai/gateway";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import type { Database } from "@/lib/db/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { createClient } from "@/lib/supabase/server";
import { buildOcrPrompt, OCR_INSTRUCTIONS } from "@/modules/ai/prompts/textbook-grounded";
import { runJobNow } from "@/modules/jobs/runner";
import { createJobsAdminClient } from "@/modules/jobs/with-service-role";
import { canExtractText, chapterTitlesOf, chunkPages } from "./chunker";
import { getExtractionStatus } from "./queries";
import {
  ExtractionIdSchema,
  StartExtractionSchema,
  UpdateChunkSchema,
  type ExtractionIdInput,
  type ExtractionSummary,
  type StartExtractionInput,
  type UpdateChunkInput,
} from "./schemas";

const BUCKET = "tenant-docs";
const IN_REQUEST_RUN_MS = 20_000;
/** Pages per OCR request; the whole file still has to fit file-input.ts caps (10 MB, 30 pages). */
const OCR_BATCH_PAGES = 5;
const OCR_MAX_OUTPUT_TOKENS = 8192;

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function startFor(ctx: TenantContext, subjectTextbookId: string): Promise<ExtractionSummary> {
  const supabase = await createClient();
  // Rule 1: the book must be in the route's school (the RPC only checks membership).
  const { data: book, error: readError } = await supabase
    .from("subject_textbooks")
    .select("id")
    .eq("id", subjectTextbookId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (readError) throwMapped(readError);
  if (!book) throw new AppError("not_found", "Book not found.");

  const { data: extractionId, error } = await supabase.rpc("start_content_extraction", { p_subject_textbook_id: subjectTextbookId });
  if (error) throwMapped(error);

  try {
    await runJobNow(createJobsAdminClient(), { institutionId: ctx.institution.id, idempotencyKey: `content.extract:${extractionId}`, timeoutMs: IN_REQUEST_RUN_MS });
  } catch (err) {
    // Left queued for the job runner; the status query shows progress.
    console.error(`[${crypto.randomUUID()}] content extraction ${extractionId}: in-request run did not finish`, { name: err instanceof Error ? err.name : "unknown" });
  }
  const status = await getExtractionStatus(ctx, { subjectTextbookId });
  if (!status) throw new AppError("internal", "Unexpected error.");
  return status;
}

export const startExtraction = defineAction({
  name: "content.extraction.start",
  module: "academic_structure",
  schema: StartExtractionSchema,
  permission: "resource.manage",
  handler: async ({ subjectTextbookId }: StartExtractionInput, ctx) => startFor(ctx, subjectTextbookId),
});

/** A new reading of the same book (the newest reading replaces the book's text). */
export const retryExtraction = defineAction({
  name: "content.extraction.retry",
  module: "academic_structure",
  schema: ExtractionIdSchema,
  permission: "resource.manage",
  handler: async ({ extractionId }: ExtractionIdInput, ctx) => {
    const supabase = await createClient();
    const { data: run, error } = await supabase
      .from("content_extractions")
      .select("subject_textbook_id")
      .eq("id", extractionId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!run) throw new AppError("not_found", "Reading not found.");
    return startFor(ctx, run.subject_textbook_id);
  },
});

const OcrResultSchema = z.object({
  pages: z.array(z.object({ page: z.number().int().min(1).max(2000), text: z.string().max(20_000) })).max(OCR_BATCH_PAGES),
});

export interface OcrBatchResult {
  extractionId: string;
  pagesRead: number[];
  remaining: number;
  status: ExtractionSummary["status"];
}

/** OCR of the next few 'needs OCR' pages. Call again while `remaining` > 0. */
export const ocrExtractionPages = defineAction({
  name: "content.extraction.ocr",
  module: "academic_structure",
  schema: ExtractionIdSchema,
  permission: "resource.manage",
  handler: async ({ extractionId }: ExtractionIdInput, ctx): Promise<OcrBatchResult> => {
    const supabase = await createClient();
    const { data: run, error } = await supabase
      .from("content_extractions")
      .select("id, status, needs_ocr_pages, document_id, subject_textbooks!inner(rights_status, ncert_code, chapter_titles)")
      .eq("id", extractionId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!run) throw new AppError("not_found", "Reading not found.");
    if (run.status !== "partial" || run.needs_ocr_pages.length === 0) throw new AppError("invalid_state", "No pages are waiting for OCR.");
    if (!canExtractText(run.subject_textbooks)) throw new AppError("invalid_state", "This book's rights status does not allow storing its text.");
    // Rule 6: local_only never reaches a cloud provider; the pages stay 'needs OCR'.
    if (ctx.institution.ai_policy === "local_only") {
      throw new AppError("ai_policy_blocked", "This school keeps AI on its own server, so scanned pages cannot be sent for OCR. They stay marked 'needs OCR'.");
    }
    if (!isModuleEnabled(ctx, "ai_teacher")) throw new AppError("ai_unavailable", "AI features are not available for your institution.");

    const { data: doc, error: docError } = await supabase.from("documents").select("path").eq("id", run.document_id).eq("status", "active").maybeSingle();
    if (docError) throwMapped(docError);
    if (!doc) throw new AppError("invalid_state", "The book's PDF was removed or replaced. Start a new reading.");
    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(doc.path);
    if (downloadError || !blob) throw new AppError("dependency_failed", "Storage is unavailable. Try again.");

    const batch = run.needs_ocr_pages.slice(0, OCR_BATCH_PAGES);
    // shortcut: the whole PDF goes with a page list (no PDF splitter installed), so only files within file-input.ts caps can be OCR'd; split pages if scanned books are common.
    const result = await runStructuredFile({
      ctx,
      feature: "content_ocr",
      schema: OcrResultSchema,
      instructions: OCR_INSTRUCTIONS,
      prompt: buildOcrPrompt(batch),
      file: { bytes: new Uint8Array(await blob.arrayBuffer()), mime: "application/pdf", fileName: "textbook.pdf" },
      maxOutputTokens: OCR_MAX_OUTPUT_TOKENS,
    });
    if (!result.ok) throw new AppError(result.error.code, result.error.message);

    const textByPage = new Map(result.data.data.pages.filter((p) => batch.includes(p.page)).map((p) => [p.page, p.text]));
    const { data: previous, error: prevError } = await supabase
      .from("content_chunks")
      .select("chapter_no, heading")
      .eq("extraction_id", run.id)
      .lt("page_from", batch[0])
      .order("page_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (prevError) throwMapped(prevError);
    const chunks = chunkPages(
      batch.map((page) => ({ page, text: textByPage.get(page) ?? "" })),
      chapterTitlesOf(run.subject_textbooks.chapter_titles),
      { chapterNo: previous?.chapter_no ?? null, heading: previous?.heading ?? null },
    );

    const { data: saved, error: saveError } = await supabase
      .rpc("save_content_ocr_pages", {
        p_extraction_id: run.id,
        p_pages: batch,
        p_chunks: chunks as unknown as Database["public"]["Functions"]["save_content_ocr_pages"]["Args"]["p_chunks"],
      });
    if (saveError) throwMapped(saveError);
    return { extractionId: run.id, pagesRead: batch, remaining: saved.needs_ocr_pages.length, status: saved.status as ExtractionSummary["status"] };
  },
});

/** An editor's correction; the first extracted text stays in original_body (0148 trigger). */
export const updateChunk = defineAction({
  name: "content.chunk.update",
  module: "academic_structure",
  schema: UpdateChunkSchema,
  permission: "resource.manage",
  handler: async ({ chunkId, body, heading }: UpdateChunkInput, ctx) => {
    const supabase = await createClient();
    // The audit keeps hashes and lengths of the text, never the book's text itself.
    const { data: before, error: readError } = await supabase.from("content_chunks").select("body").eq("id", chunkId).eq("institution_id", ctx.institution.id).maybeSingle();
    if (readError) throwMapped(readError);
    const { data, error } = await supabase
      .from("content_chunks")
      .update({ body, heading })
      .eq("id", chunkId)
      .eq("institution_id", ctx.institution.id)
      .select("id, edited_at")
      .maybeSingle();
    if (error) {
      if (error.code === "42501") throw new AppError("forbidden", "You can only correct books for subjects you teach.");
      throwMapped(error);
    }
    if (!data) throw new AppError("not_found", "Text not found, or you cannot correct it.");
    await audit(ctx, {
      action: "content.chunk.update",
      entityType: "content_chunk",
      entityId: chunkId,
      before: before ? { sha256: sha256(before.body), chars: before.body.length } : null,
      after: { sha256: sha256(body), chars: body.length, heading: heading !== undefined },
    });
    return { id: data.id, editedAt: data.edited_at };
  },
});
