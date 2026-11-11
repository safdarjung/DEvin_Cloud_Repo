"use server";

// M05-T3/T4 — document.requestUpload / document.confirmUpload /
// document.getReadUrl / document.delete (06 brief M05, rulings in
// M05-tasks.md header). Object access is delegated to `documents` RLS
// (storage.objects policies only check a visible/pending row at the same
// path) — every storage call below uses the caller's own client
// (createClient()), never service role. Mirrors src/modules/imports/actions.ts
// (defineAction, throwMapped, snake_case audit strings, ids-only metadata).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  ConfirmUploadSchema,
  DeleteDocumentSchema,
  GetReadUrlSchema,
  RequestUploadSchema,
  type ConfirmUploadInput,
  type DeleteDocumentInput,
  type GetReadUrlInput,
  type RequestUploadInput,
} from "@/modules/documents/schemas";

type DocumentsClient = Awaited<ReturnType<typeof createClient>>;

const BUCKET = "tenant-docs";
const READ_URL_EXPIRES_IN = 60;

const ENTITY_TABLE: Record<string, "students" | "staff" | "applications" | "assignment_submissions" | "resources"> = {
  student: "students",
  staff: "staff",
  application: "applications",
  submission: "assignment_submissions",
  resource: "resources",
};

const POSTGRES_RLS_VIOLATION = "42501";

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Packet rule 2: verify the entity belongs to the caller's institution and is
 * visible under their own RLS before any document row is created for it. */
async function requireVisibleEntity(
  supabase: DocumentsClient,
  institutionId: string,
  entityType: RequestUploadInput["entityType"],
  entityId: string,
): Promise<void> {
  const table = ENTITY_TABLE[entityType];
  const { data, error } = await supabase.from(table).select("id").eq("id", entityId).eq("institution_id", institutionId).maybeSingle();
  if (error) throwMapped(error);
  if (!data) throw new AppError("not_found", "Entity not found.");
}

function splitStoragePath(storedPath: string): { dir: string; name: string } {
  const idx = storedPath.lastIndexOf("/");
  return { dir: storedPath.slice(0, idx), name: storedPath.slice(idx + 1) };
}

/** Caller's own client, same as every storage call here — no service role. */
async function objectExistsInStorage(supabase: DocumentsClient, storedPath: string): Promise<boolean> {
  const { dir, name } = splitStoragePath(storedPath);
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: name, limit: 1 });
  if (error) throwMapped(error);
  return (data ?? []).some((file) => file.name === name);
}

export const requestUpload = defineAction({
  name: "document.requestUpload",
  module: "core",
  schema: RequestUploadSchema,
  permission: "document.write",
  handler: async (input: RequestUploadInput, ctx) => {
    const supabase = await createClient();
    await requireVisibleEntity(supabase, ctx.institution.id, input.entityType, input.entityId);

    const documentId = crypto.randomUUID();
    const path = `${ctx.institution.id}/${input.entityType}/${input.entityId}/${documentId}.${MIME_EXT[input.mime]}`;

    const { error: insertError } = await supabase.from("documents").insert({
      id: documentId,
      institution_id: ctx.institution.id,
      entity_type: input.entityType,
      entity_id: input.entityId,
      kind: input.kind,
      file_name: input.fileName,
      mime: input.mime,
      size_bytes: input.sizeBytes,
      path,
      created_by: ctx.user.id,
    });
    if (insertError) {
      // RLS denies the insert (e.g. a student on a graded/foreign submission,
      // or on an entity_type their role has no insert branch for) -> 42501.
      if (insertError.code === POSTGRES_RLS_VIOLATION) {
        throw new AppError("forbidden", "Not allowed to upload for this entity.");
      }
      throwMapped(insertError);
    }

    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (signError) throwMapped(signError);

    await audit(ctx, {
      action: "document.upload_requested",
      entityType: "document",
      entityId: documentId,
      after: { entityType: input.entityType, entityId: input.entityId },
    });

    return { documentId, path, token: signed.token, signedUrl: signed.signedUrl };
  },
});

export const confirmUpload = defineAction({
  name: "document.confirmUpload",
  module: "core",
  schema: ConfirmUploadSchema,
  permission: "document.write",
  handler: async ({ documentId }: ConfirmUploadInput, ctx) => {
    const supabase = await createClient();
    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, path, status")
      .eq("id", documentId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (error) throwMapped(error);
    if (!doc) throw new AppError("not_found", "Document not found.");
    if (doc.status !== "pending") throw new AppError("invalid_state", "Document is not awaiting upload.");

    const exists = await objectExistsInStorage(supabase, doc.path);
    if (!exists) throw new AppError("invalid_state", "No uploaded object found for this document.");

    const { data: updated, error: updateError } = await supabase
      .from("documents")
      .update({ status: "active" })
      .eq("id", documentId)
      .select("id")
      .maybeSingle();
    if (updateError) throwMapped(updateError);
    if (!updated) throw new AppError("not_found", "Document not found.");

    await audit(ctx, { action: "document.upload_confirmed", entityType: "document", entityId: documentId });

    return { documentId, status: "active" as const };
  },
});

export const getReadUrl = defineAction({
  name: "document.getReadUrl",
  module: "core",
  schema: GetReadUrlSchema,
  permission: "document.read",
  handler: async ({ documentId }: GetReadUrlInput, ctx) => {
    const supabase = await createClient();
    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, path, file_name, mime")
      .eq("id", documentId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!doc) throw new AppError("not_found", "Document not found.");

    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, READ_URL_EXPIRES_IN);
    if (signError) throwMapped(signError);

    await audit(ctx, { action: "document.read_url", entityType: "document", entityId: documentId });

    return { url: signed.signedUrl, expiresIn: READ_URL_EXPIRES_IN, fileName: doc.file_name, mime: doc.mime };
  },
});

export const deleteDocument = defineAction({
  name: "document.delete",
  module: "core",
  schema: DeleteDocumentSchema,
  permission: "document.write",
  handler: async ({ documentId }: DeleteDocumentInput, ctx) => {
    const supabase = await createClient();
    const { data: updated, error } = await supabase
      .from("documents")
      .update({ status: "deleted", deleted_at: new Date().toISOString(), deleted_by: ctx.user.id })
      .eq("id", documentId)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!updated) throw new AppError("not_found", "Document not found.");

    await audit(ctx, { action: "document.delete", entityType: "document", entityId: documentId });

    return { documentId, status: "deleted" as const };
  },
});
