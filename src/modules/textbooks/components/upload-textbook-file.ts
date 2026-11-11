// Browser side of the textbook PDF upload (0142), same three steps as
// upload-file.ts: request -> PUT to private storage with progress -> confirm
// (server checks the object exists and starts with %PDF-). Client components only.
import { describeActionError } from "@/lib/action-error";
import { confirmTextbookFile, requestTextbookFile } from "@/modules/textbooks/files.actions";
import { MAX_TEXTBOOK_FILE_BYTES } from "@/modules/textbooks/schemas";
import { put } from "./upload-file";

export const MAX_TEXTBOOK_FILE_MB = MAX_TEXTBOOK_FILE_BYTES / 1048576;

/** Pre-check mirroring the action: PDF only, 1 byte to the textbook cap. */
export function checkTextbookPdf(file: { type: string; size: number }): string | null {
  if (file.type !== "application/pdf") return "Only PDF files can be uploaded for a textbook.";
  if (file.size < 1) return "The file is empty.";
  if (file.size > MAX_TEXTBOOK_FILE_BYTES) return `The file is larger than ${MAX_TEXTBOOK_FILE_MB} MB.`;
  return null;
}

export async function uploadTextbookPdf(institutionSlug: string, textbookId: string, file: File, onProgress: (pct: number) => void): Promise<{ ok: true } | { ok: false; error: string }> {
  const bad = checkTextbookPdf(file);
  if (bad) return { ok: false, error: bad };
  const req = await requestTextbookFile(institutionSlug, { textbookId, fileName: file.name.slice(0, 200), sizeBytes: file.size });
  if (!req.ok) return { ok: false, error: describeActionError(req.error) };
  onProgress(0);
  if (!(await put(req.data.signedUrl, file, onProgress))) return { ok: false, error: "The file could not be uploaded. Check your connection and try again." };
  const done = await confirmTextbookFile(institutionSlug, { textbookId });
  return done.ok ? { ok: true } : { ok: false, error: describeActionError(done.error) };
}
