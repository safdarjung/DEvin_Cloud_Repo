import { ALLOWED_MIMES, MAX_DOCUMENT_SIZE_BYTES } from "./schemas.ts";

/** Client-side pre-check mirroring the action's limits; returns an error message or null. */
export function checkUploadFile(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_MIMES as readonly string[]).includes(file.type)) return "Only PDF, JPEG or PNG files are allowed.";
  if (file.size < 1) return "The file is empty.";
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) return `The file is larger than ${MAX_DOCUMENT_SIZE_BYTES / 1048576} MB.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
