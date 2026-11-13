// 0148 — content extraction / search inputs (15-learning-exam-system-plan.md Phase 2).
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const StartExtractionSchema = z.object({ subjectTextbookId: uuid }).strict();
export type StartExtractionInput = z.infer<typeof StartExtractionSchema>;

export const ExtractionIdSchema = z.object({ extractionId: uuid }).strict();
export type ExtractionIdInput = z.infer<typeof ExtractionIdSchema>;

export const ExtractionStatusSchema = z.object({ subjectTextbookId: uuid }).strict();
export type ExtractionStatusInput = z.infer<typeof ExtractionStatusSchema>;

export const UpdateChunkSchema = z
  .object({
    chunkId: uuid,
    body: z.string().trim().min(1).max(4000),
    heading: z.string().trim().min(1).max(200).nullable().optional(),
  })
  .strict();
export type UpdateChunkInput = z.infer<typeof UpdateChunkSchema>;

export const chapterNo = z.number().int().min(1).max(99);

export const ContentSearchSchema = z
  .object({
    q: z.string().trim().min(1).max(200),
    subjectTextbookId: uuid.optional(),
    gradeId: uuid.optional(),
    subjectId: uuid.optional(),
    chapterNo: chapterNo.optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export type ContentSearchInput = z.infer<typeof ContentSearchSchema>;

export type ExtractionStatus = "queued" | "running" | "done" | "failed" | "partial";

export interface ExtractionSummary {
  id: string;
  status: ExtractionStatus;
  pagesTotal: number | null;
  pagesDone: number;
  pagesOcr: number;
  /** Pages with no text layer still waiting for OCR ('needs OCR'). */
  needsOcrPages: number[];
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  chunkCount: number;
}

export interface ContentSearchHit {
  chunkId: string;
  subjectTextbookId: string;
  bookTitle: string | null;
  chapterNo: number | null;
  heading: string | null;
  pageFrom: number;
  pageTo: number;
  /** Plain text; matches wrapped in « ». */
  snippet: string;
  rank: number;
}
