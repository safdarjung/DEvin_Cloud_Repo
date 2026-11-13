import "server-only";
// 0148 / Phase 2 (15-learning-exam-system-plan.md) — a chapter summary from
// the book's extracted text only, each key point citing a page that was
// actually retrieved (otherwise the page is dropped). Returned, never stored.
// Students (ai.study, ai_student module) and staff (academics.read) for books
// they can read: content_chunks RLS (0148) scopes retrieval through the
// user client, so a book outside the caller's reach yields no text. Guardians
// are refused (they lack ai.study and are not staff).
import { fail, ok, type ActionResult } from "@/lib/actions/result";
import { runStructured } from "@/lib/ai/gateway";
import { createClient } from "@/lib/supabase/server";
import { buildChapterSummaryPrompt, CHAPTER_SUMMARY_INSTRUCTIONS } from "@/modules/ai/prompts/textbook-grounded";
import { aiTaskRoute } from "@/modules/ai/task-route";
import { chapterTitlesOf } from "@/modules/content/chunker";
import {
  ChapterSummaryGenerationSchema,
  ChapterSummaryRequestSchema,
  contextChars,
  INSUFFICIENT_SOURCE,
  MIN_CONTEXT_CHARS,
  pageIsRetrieved,
  selectContext,
  type ChapterSummaryRequest,
} from "@/modules/content/grounding";
import { findChunks } from "@/modules/content/queries";
import type { TenantContext } from "@/lib/auth/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHAPTER_CHUNK_LIMIT = 50;
const MAX_OUTPUT_TOKENS = 2048;

export interface ChapterSummaryResponse {
  summary: string | null;
  keyPoints: { point: string; page: number | null }[];
  /** Pages the summary was written from; less than the chapter when it ran past the 12k-character cap. */
  pages: { from: number; to: number } | null;
  truncated: boolean;
  note: string | null;
  provider: string | null;
  model: string | null;
}

/** Students and guardians take the learner gate (ai.study); guardians lack it, so they are refused. */
const learner = (ctx: TenantContext) => ctx.membership.role === "student" || ctx.membership.role === "guardian";

export const POST = aiTaskRoute<ChapterSummaryRequest, ChapterSummaryResponse>({
  route: "chapter-summary",
  schema: ChapterSummaryRequestSchema,
  maxBodyBytes: 4 * 1024,
  permission: (ctx) => (learner(ctx) ? "ai.study" : "academics.read"),
  capability: (ctx) => (learner(ctx) ? "study_studio" : "question_paper_builder"),
  module: (ctx) => (learner(ctx) ? "ai_student" : "ai_teacher"),
  run: async (ctx, input): Promise<ActionResult<ChapterSummaryResponse>> => {
    const supabase = await createClient();
    const { data: book, error } = await supabase
      .from("subject_textbooks")
      .select("id, grade_id, subject_id, custom_title, chapter_titles")
      .eq("id", input.subjectTextbookId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throw error;
    if (!book) return fail("not_found", "Book not found.");

    const rows = await findChunks(ctx, { subjectTextbookId: book.id, chapterNos: [input.chapterNo], q: null, limit: CHAPTER_CHUNK_LIMIT });
    const chunks = selectContext(rows);
    const empty: ChapterSummaryResponse = { summary: null, keyPoints: [], pages: null, truncated: false, note: INSUFFICIENT_SOURCE, provider: null, model: null };
    if (contextChars(chunks) < MIN_CONTEXT_CHARS) return ok(empty);

    const chapterTitle = chapterTitlesOf(book.chapter_titles)[String(input.chapterNo)] ?? chunks[0].heading;
    const generated = await runStructured({
      ctx,
      feature: "chapter_summary",
      agentCloud: ctx.institution.ai_policy !== "local_only", // never under local_only (rule 6); textbook text only, no student data; redacted on the cloud path
      permission: learner(ctx) ? "ai.study" : "ai.generate",
      schema: ChapterSummaryGenerationSchema,
      instructions: CHAPTER_SUMMARY_INSTRUCTIONS,
      prompt: buildChapterSummaryPrompt({ bookTitle: book.custom_title ?? "Textbook", chapterNo: input.chapterNo, chapterTitle, chunks }),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    if (!generated.ok) return generated;

    const { summary, keyPoints } = generated.data.data;
    return ok({
      summary,
      keyPoints: keyPoints.map((k) => ({ point: k.point, page: pageIsRetrieved(k.page, chunks) ? k.page : null })),
      pages: { from: chunks[0].pageFrom, to: chunks[chunks.length - 1].pageTo },
      truncated: chunks.length < rows.length || rows.length === CHAPTER_CHUNK_LIMIT,
      note: null,
      provider: generated.data.provider,
      model: generated.data.model,
    });
  },
});
