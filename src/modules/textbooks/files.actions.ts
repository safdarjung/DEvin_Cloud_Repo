"use server";

// textbook.link.* / textbook.file.* (migration 0142): a school's own link and
// uploaded PDF on a textbook row, beside the official NCERT link. The file
// uses the documents flow (0067) with entity_type 'subject_textbook':
// request (pending documents row + signed upload URL) -> PUT straight to
// private storage -> confirm (object exists + %PDF- bytes) -> active. Caller's
// client only; RLS decides who writes (leaders, the grade+subject's teacher)
// and who reads (staff, that grade+subject's students and guardians).
// Gate: resource.manage to change, academics.read to open.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { matchesMagic } from "./file-check";
import { objectHead } from "./object-head";
import {
  RequestTextbookFileSchema,
  SetTextbookLinkSchema,
  TextbookIdSchema,
  type RequestTextbookFileInput,
  type SetTextbookLinkInput,
  type TextbookIdInput,
} from "./schemas";

const BUCKET = "tenant-docs";
const READ_URL_EXPIRES_IN = 60;
const FORBIDDEN = "You can only change books for subjects you teach.";

function throwWrite(error: { code?: string | null }, forbidden: string): never {
  if (error.code === "42501") throw new AppError("forbidden", forbidden);
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const setTextbookLink = defineAction({
  name: "textbook.link.set",
  module: "academic_structure",
  schema: SetTextbookLinkSchema,
  permission: "resource.manage",
  handler: async ({ textbookId, url }: SetTextbookLinkInput, ctx) => {
    const supabase = await createClient();
    const { data: book, error: readError } = await supabase
      .from("subject_textbooks")
      .select("id, ncert_code")
      .eq("id", textbookId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (readError) throw readError;
    if (!book) throw new AppError("not_found", "Book not found.");
    // NCERT rows keep the official link apart; a custom book's link is its custom_url.
    const patch = book.ncert_code ? { school_url: url } : { custom_url: url };
    const { data, error } = await supabase.from("subject_textbooks").update(patch).eq("id", textbookId).eq("institution_id", ctx.institution.id).select("id");
    if (error) throwWrite(error, FORBIDDEN);
    if (!data?.length) throw new AppError("forbidden", FORBIDDEN);
    await audit(ctx, { action: url ? "textbook.link_set" : "textbook.link_clear", entityType: "subject_textbook", entityId: textbookId });
    return { id: textbookId, url };
  },
});

export const requestTextbookFile = defineAction({
  name: "textbook.file.requestUpload",
  module: "academic_structure",
  schema: RequestTextbookFileSchema,
  permission: "resource.manage",
  handler: async (input: RequestTextbookFileInput, ctx) => {
    const supabase = await createClient();
    const { data: book, error: readError } = await supabase.from("subject_textbooks").select("id").eq("id", input.textbookId).eq("institution_id", ctx.institution.id).maybeSingle();
    if (readError) throw readError;
    if (!book) throw new AppError("not_found", "Book not found.");

    const documentId = crypto.randomUUID();
    const path = `${ctx.institution.id}/subject_textbook/${input.textbookId}/${documentId}.pdf`;
    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      institution_id: ctx.institution.id,
      entity_type: "subject_textbook",
      entity_id: input.textbookId,
      kind: "textbook",
      file_name: input.fileName,
      mime: "application/pdf",
      size_bytes: input.sizeBytes,
      path,
      created_by: ctx.user.id,
    });
    if (docError) throwWrite(docError, FORBIDDEN);

    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (signError) throw new AppError("dependency_failed", "Storage is unavailable. Try again.");
    await audit(ctx, { action: "textbook.file_upload_requested", entityType: "subject_textbook", entityId: input.textbookId, after: { sizeBytes: input.sizeBytes } });
    return { documentId, path, token: signed.token, signedUrl: signed.signedUrl };
  },
});

export const confirmTextbookFile = defineAction({
  name: "textbook.file.confirmUpload",
  module: "academic_structure",
  schema: TextbookIdSchema,
  permission: "resource.manage",
  handler: async ({ textbookId }: TextbookIdInput, ctx) => {
    const supabase = await createClient();
    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, path, mime, file_name, size_bytes")
      .eq("entity_type", "subject_textbook")
      .eq("entity_id", textbookId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "pending")
      .eq("created_by", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw new AppError("invalid_state", "This file is not awaiting upload.");

    const head = await objectHead(supabase, doc.path);
    if (!head) throw new AppError("invalid_state", "No uploaded file found. Try uploading again.");
    if (!matchesMagic(doc.mime, head)) throw new AppError("validation_failed", "That file is not a real PDF.", { file: ["File content does not match its type"] });

    const { data: updated, error: updateError } = await supabase.from("documents").update({ status: "active" }).eq("id", doc.id).select("id");
    if (updateError) throwWrite(updateError, FORBIDDEN);
    if (!updated?.length) throw new AppError("not_found", "Upload not found.");
    // A replacement retires the previous copy.
    const { error: retireError } = await supabase
      .from("documents")
      .update({ status: "deleted" })
      .eq("entity_type", "subject_textbook")
      .eq("entity_id", textbookId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .neq("id", doc.id);
    if (retireError) throwWrite(retireError, FORBIDDEN);
    await audit(ctx, { action: "textbook.file_upload_confirmed", entityType: "subject_textbook", entityId: textbookId });
    return { textbookId, fileName: doc.file_name, sizeBytes: doc.size_bytes };
  },
});

export const removeTextbookFile = defineAction({
  name: "textbook.file.remove",
  module: "academic_structure",
  schema: TextbookIdSchema,
  permission: "resource.manage",
  handler: async ({ textbookId }: TextbookIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("documents")
      .update({ status: "deleted" })
      .eq("entity_type", "subject_textbook")
      .eq("entity_id", textbookId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .select("id");
    if (error) throwWrite(error, FORBIDDEN);
    if (!data?.length) throw new AppError("not_found", "No file to remove, or you cannot remove it.");
    await audit(ctx, { action: "textbook.file_remove", entityType: "subject_textbook", entityId: textbookId });
    return { textbookId };
  },
});

export const getTextbookFileUrl = defineAction({
  name: "textbook.file.readUrl",
  module: "academic_structure",
  schema: TextbookIdSchema,
  permission: "academics.read",
  handler: async ({ textbookId }: TextbookIdInput, ctx) => {
    const supabase = await createClient();
    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, path, file_name")
      .eq("entity_type", "subject_textbook")
      .eq("entity_id", textbookId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw new AppError("not_found", "File not found.");
    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, READ_URL_EXPIRES_IN);
    if (signError) throw new AppError("not_found", "File not found.");
    await audit(ctx, { action: "document.read_url", entityType: "document", entityId: doc.id });
    return { url: signed.signedUrl, expiresIn: READ_URL_EXPIRES_IN, fileName: doc.file_name };
  },
});
