// M05-T3/T4 — zod schemas for document upload/read/delete/list. Relative +
// .ts import: mirrors src/modules/imports/schemas.ts (seed-script safe).
import { z } from "zod";
import { uuid } from "../../lib/schemas/common.ts";

// Mirrors migration 0067's `entity_type`/`mime` check constraints exactly.
export const ENTITY_TYPES = ["student", "staff", "application", "submission", "resource"] as const;
export const ALLOWED_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_DOCUMENT_SIZE_BYTES = 10485760;

export const RequestUploadSchema = z
  .object({
    entityType: z.enum(ENTITY_TYPES),
    entityId: uuid,
    kind: z.string().trim().min(1).max(60),
    fileName: z.string().trim().min(1).max(200),
    mime: z.enum(ALLOWED_MIMES),
    sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_SIZE_BYTES),
  })
  .strict();
export type RequestUploadInput = z.infer<typeof RequestUploadSchema>;

export const ConfirmUploadSchema = z.object({ documentId: uuid }).strict();
export type ConfirmUploadInput = z.infer<typeof ConfirmUploadSchema>;

export const GetReadUrlSchema = z.object({ documentId: uuid }).strict();
export type GetReadUrlInput = z.infer<typeof GetReadUrlSchema>;

export const DeleteDocumentSchema = z.object({ documentId: uuid }).strict();
export type DeleteDocumentInput = z.infer<typeof DeleteDocumentSchema>;

export const ListForEntitySchema = z
  .object({ entityType: z.enum(ENTITY_TYPES), entityId: uuid })
  .strict();
export type ListForEntityInput = z.infer<typeof ListForEntitySchema>;
