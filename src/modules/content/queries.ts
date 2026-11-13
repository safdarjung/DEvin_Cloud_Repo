import "server-only";
// 0148 — reads of extracted textbook text. Caller's client only: RLS decides
// rows (staff of the school; students/guardians of the book's grade+subject;
// only while the book's rights allow storing text).
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { ContentSearchHit, ContentSearchInput, ExtractionStatus, ExtractionStatusInput, ExtractionSummary } from "./schemas";

export interface RetrievedChunk extends ContentSearchHit {
  body: string;
}

export interface ChunkFilter {
  q?: string | null;
  subjectTextbookId?: string;
  gradeId?: string;
  subjectId?: string;
  chapterNos?: number[];
  limit?: number;
}

/** search_content_chunks: ranked full-text hits, or (no q) chunks in page order. */
export async function findChunks(ctx: TenantContext, filter: ChunkFilter): Promise<RetrievedChunk[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_content_chunks", {
    p_institution_id: ctx.institution.id,
    p_q: filter.q ?? undefined,
    p_subject_textbook_id: filter.subjectTextbookId,
    p_grade_id: filter.gradeId,
    p_subject_id: filter.subjectId,
    p_chapter_nos: filter.chapterNos?.length ? filter.chapterNos : undefined,
    p_limit: filter.limit ?? 20,
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    chunkId: r.id,
    subjectTextbookId: r.subject_textbook_id,
    bookTitle: r.book_title,
    chapterNo: r.chapter_no,
    heading: r.heading,
    pageFrom: r.page_from,
    pageTo: r.page_to,
    snippet: r.snippet,
    rank: r.rank,
    body: r.body,
  }));
}

export async function searchContent(ctx: TenantContext, input: ContentSearchInput): Promise<ContentSearchHit[]> {
  const rows = await findChunks(ctx, {
    q: input.q,
    subjectTextbookId: input.subjectTextbookId,
    gradeId: input.gradeId,
    subjectId: input.subjectId,
    chapterNos: input.chapterNo ? [input.chapterNo] : undefined,
    limit: input.limit,
  });
  return rows.map((row) => {
    const hit: ContentSearchHit & { body?: string } = { ...row };
    delete hit.body;
    return hit;
  });
}

/** The book's newest reading, or null when it was never read (or the caller cannot see it). */
export async function getExtractionStatus(ctx: TenantContext, input: ExtractionStatusInput): Promise<ExtractionSummary | null> {
  const supabase = await createClient();
  const { data: run, error } = await supabase
    .from("content_extractions")
    .select("id, status, pages_total, pages_done, pages_ocr, needs_ocr_pages, error, started_at, finished_at, created_at")
    .eq("institution_id", ctx.institution.id)
    .eq("subject_textbook_id", input.subjectTextbookId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!run) return null;
  const { count, error: countError } = await supabase
    .from("content_chunks")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institution.id)
    .eq("subject_textbook_id", input.subjectTextbookId);
  if (countError) throw countError;
  return {
    id: run.id,
    status: run.status as ExtractionStatus,
    pagesTotal: run.pages_total,
    pagesDone: run.pages_done,
    pagesOcr: run.pages_ocr,
    needsOcrPages: run.needs_ocr_pages,
    error: run.error,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    createdAt: run.created_at,
    chunkCount: count ?? 0,
  };
}
