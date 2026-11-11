// The multimodal file path's hard limits (gateway.runStructuredFile). Pure.
// Binary content cannot pass through the text redactor (redact.ts works on
// strings), so a file is sent only to a provider whose installed SDK takes
// file parts (Gemini: @ai-sdk/google turns a `file` part into inlineData;
// @ai-sdk/groq refuses non-image files), only when the role's cloud switch is
// on, one file per request, within these caps. No fallback to a text-only
// model: it would answer without having read the file.
import type { ErrorCode } from "@/lib/actions/result";

export const FILE_READ_MAX_BYTES = 10 * 1024 * 1024;
/** Checked when the PDF's page tree is readable; otherwise the byte cap alone applies. */
export const FILE_READ_MAX_PDF_PAGES = 30;
export const FILE_READ_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const;

export const FILE_UNREADABLE_NOW = "This file cannot be read right now. Nothing was saved. Try again later, or paste the text instead.";

export interface FileReadGateInput {
  geminiKey: boolean;
  cloudSwitch: boolean;
  mime: string;
  sizeBytes: number;
  pages: number | null;
}

export type FileReadGate = { ok: true } | { ok: false; code: ErrorCode; message: string };

export function fileReadGate(input: FileReadGateInput): FileReadGate {
  if (!input.cloudSwitch) {
    return { ok: false, code: "ai_policy_blocked", message: "Reading files needs the school's cloud AI, which is switched off for your role." };
  }
  if (!input.geminiKey) return { ok: false, code: "ai_unavailable", message: FILE_UNREADABLE_NOW };
  if (!(FILE_READ_MIMES as readonly string[]).includes(input.mime)) {
    return { ok: false, code: "validation_failed", message: "Only PDF, JPEG and PNG files can be read." };
  }
  if (input.sizeBytes > FILE_READ_MAX_BYTES) {
    return { ok: false, code: "validation_failed", message: `This file is over ${FILE_READ_MAX_BYTES / 1024 / 1024} MB, too big to read. Split it or upload one chapter.` };
  }
  if (input.pages !== null && input.pages > FILE_READ_MAX_PDF_PAGES) {
    return { ok: false, code: "validation_failed", message: `This PDF has ${input.pages} pages; up to ${FILE_READ_MAX_PDF_PAGES} can be read at once. Upload one chapter.` };
  }
  return { ok: true };
}

/**
 * Pages of a PDF from its uncompressed page tree: the larger of the largest
 * `/Count` and the number of `/Type /Page` objects. null when neither is
 * visible (compressed object streams): the byte cap still applies.
 */
export function countPdfPages(bytes: Uint8Array): number | null {
  const text = new TextDecoder("latin1").decode(bytes);
  const pages = (text.match(/\/Type\s*\/Page(?![a-z])/gi) ?? []).length;
  const counts = [...text.matchAll(/\/Count\s+(\d{1,6})/g)].map((m) => Number(m[1]));
  const best = Math.max(pages, ...counts, 0);
  return best > 0 ? best : null;
}
