"use server";

// curriculum.material.* (migration 0139): the school's own files on a
// subject or unit, through the documents upload pattern (0067): a material
// row, a pending documents row (entity_type 'curriculum_material'), a
// signed upload straight to the private tenant-docs bucket, then confirm
// (object exists + first bytes match the declared type) -> active. Caller's
// client only; RLS decides every row and object:
//   staff upload   -> class material (or private / unfiled)
//   student upload -> their private shelf; suggest -> subject teacher or a
//                     leader approves (visibility 'class', owner unchanged)
// Gate: academics.read for what students and staff share (RLS narrows),
// resource.manage for reviewing a suggestion. The chat attach flow uploads
// unfiled and files it with curriculum.material.attach — the same action
// the "My files" UI uses.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import { matchesMagic } from "./file-check";
import { attachTargets } from "./materials.queries";
import { objectHead } from "./object-head";
import {
  AttachMaterialSchema,
  MaterialIdSchema,
  RequestMaterialUploadSchema,
  ReviewMaterialSchema,
  SuggestMaterialSchema,
  type AttachMaterialInput,
  type MaterialIdInput,
  type RequestMaterialUploadInput,
  type ReviewMaterialInput,
  type SuggestMaterialInput,
} from "./schemas";

type Client = Awaited<ReturnType<typeof createClient>>;

const BUCKET = "tenant-docs";
const READ_URL_EXPIRES_IN = 60;
const MIME_EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const STAFF = new Set(["owner", "principal", "admin", "teacher"]);

function throwWrite(error: { code?: string | null }, forbidden: string): never {
  if (error.code === "42501") throw new AppError("forbidden", forbidden);
  if (error.code === "23503") throw new AppError("not_found", "Grade, subject or unit not found.");
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

function ownerOf(ctx: TenantContext): { ownerKind: "staff" | "student"; studentId: string | null } {
  if (ctx.membership.role === "student" && ctx.membership.studentId) return { ownerKind: "student", studentId: ctx.membership.studentId };
  if (STAFF.has(ctx.membership.role)) return { ownerKind: "staff", studentId: null };
  throw new AppError("forbidden", "Only teachers, school leaders and students can upload class files.");
}

/** A unit given with a target must belong to that grade and subject. */
async function checkUnit(supabase: Client, ctx: TenantContext, t: { gradeId: string; subjectId: string; unitId?: string }): Promise<void> {
  if (!t.unitId) return;
  const { data, error } = await supabase
    .from("curriculum_units")
    .select("grade_id, subject_id")
    .eq("id", t.unitId)
    .eq("institution_id", ctx.institution.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AppError("not_found", "Unit not found.");
  if (data.grade_id !== t.gradeId || data.subject_id !== t.subjectId) {
    throw new AppError("validation_failed", "That unit belongs to another grade or subject.", { unitId: ["Not in this subject"] });
  }
}

const titleFrom = (fileName: string) => fileName.replace(/\.[a-z0-9]{1,5}$/i, "").slice(0, 160) || "File";

export const requestMaterialUpload = defineAction({
  name: "curriculum.material.requestUpload",
  module: "academic_structure",
  schema: RequestMaterialUploadSchema,
  permission: "academics.read",
  handler: async (input: RequestMaterialUploadInput, ctx) => {
    const { ownerKind, studentId } = ownerOf(ctx);
    const supabase = await createClient();
    if (input.target) await checkUnit(supabase, ctx, input.target);

    const materialId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const visibility = ownerKind === "staff" && input.target && !input.private ? "class" : "private";
    const { error: materialError } = await supabase.from("curriculum_materials").insert({
      id: materialId,
      institution_id: ctx.institution.id,
      title: input.title ?? titleFrom(input.fileName),
      grade_id: input.target?.gradeId ?? null,
      subject_id: input.target?.subjectId ?? null,
      curriculum_unit_id: input.target?.unitId ?? null,
      owner_kind: ownerKind,
      student_id: studentId,
      visibility,
      created_by: ctx.user.id,
    });
    if (materialError) throwWrite(materialError, ownerKind === "student" ? "You can only add files to your own subjects." : "You can only share files in subjects you teach.");

    const path = `${ctx.institution.id}/curriculum_material/${materialId}/${documentId}.${MIME_EXT[input.mime]}`;
    const { error: docError } = await supabase.from("documents").insert({
      id: documentId,
      institution_id: ctx.institution.id,
      entity_type: "curriculum_material",
      entity_id: materialId,
      kind: "curriculum",
      file_name: input.fileName,
      mime: input.mime,
      size_bytes: input.sizeBytes,
      path,
      created_by: ctx.user.id,
    });
    if (docError) {
      await supabase.from("curriculum_materials").delete().eq("id", materialId);
      throwWrite(docError, "Not allowed to upload this file.");
    }

    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
    if (signError) throw new AppError("dependency_failed", "Storage is unavailable. Try again.");

    await audit(ctx, { action: "curriculum.material.upload_requested", entityType: "curriculum_material", entityId: materialId, after: { visibility, filed: Boolean(input.target) } });
    return { materialId, documentId, path, token: signed.token, signedUrl: signed.signedUrl };
  },
});

export const confirmMaterialUpload = defineAction({
  name: "curriculum.material.confirmUpload",
  module: "academic_structure",
  schema: MaterialIdSchema,
  permission: "academics.read",
  handler: async ({ materialId }: MaterialIdInput, ctx) => {
    const supabase = await createClient();
    const { data: material, error: mError } = await supabase
      .from("curriculum_materials")
      .select("id, subject_id, created_by")
      .eq("id", materialId)
      .eq("institution_id", ctx.institution.id)
      .maybeSingle();
    if (mError) throw mError;
    if (!material || material.created_by !== ctx.user.id) throw new AppError("not_found", "Upload not found.");
    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, path, mime, file_name, size_bytes, status")
      .eq("entity_type", "curriculum_material")
      .eq("entity_id", materialId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "pending")
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw new AppError("invalid_state", "This file is not awaiting upload.");

    const head = await objectHead(supabase, doc.path);
    if (!head) throw new AppError("invalid_state", "No uploaded file found. Try uploading again.");
    if (!matchesMagic(doc.mime, head)) {
      // Not what it claims to be: drop the material (its pending document becomes unreachable).
      await supabase.from("curriculum_materials").delete().eq("id", materialId);
      throw new AppError("validation_failed", "That file is not a real PDF, JPEG or PNG.", { file: ["File content does not match its type"] });
    }

    const { data: updated, error: updateError } = await supabase.from("documents").update({ status: "active" }).eq("id", doc.id).select("id");
    if (updateError) throwWrite(updateError, "Not allowed to confirm this upload.");
    if (!updated?.length) throw new AppError("not_found", "Upload not found.");
    await audit(ctx, { action: "curriculum.material.upload_confirmed", entityType: "curriculum_material", entityId: materialId });

    // Unfiled (chat attach): hand back where it may go, so the assistant can propose a place.
    const targets = material.subject_id ? [] : await attachTargets(ctx);
    return { materialId, fileName: doc.file_name, sizeBytes: doc.size_bytes, filed: material.subject_id !== null, targets };
  },
});

export const attachMaterial = defineAction({
  name: "curriculum.material.attach",
  module: "academic_structure",
  schema: AttachMaterialSchema,
  permission: "academics.read",
  handler: async (input: AttachMaterialInput, ctx) => {
    const { ownerKind } = ownerOf(ctx);
    if (ownerKind === "student" && input.share === "class") throw new AppError("forbidden", "Students suggest a file to the teacher instead of sharing it.");
    if (ownerKind === "staff" && input.share === "suggest") throw new AppError("validation_failed", "Staff files are shared directly.", { share: ["Choose private or class"] });
    const supabase = await createClient();
    await checkUnit(supabase, ctx, input);
    const place = {
      grade_id: input.gradeId,
      subject_id: input.subjectId,
      curriculum_unit_id: input.unitId ?? null,
      ...(input.title ? { title: input.title } : {}),
    };
    const patch =
      ownerKind === "student"
        ? { ...place, suggestion: input.share === "suggest" ? "suggested" : "none" }
        : { ...place, visibility: input.share === "class" ? "class" : "private" };
    const { data, error } = await supabase
      .from("curriculum_materials")
      .update(patch)
      .eq("id", input.materialId)
      .eq("institution_id", ctx.institution.id)
      .eq("created_by", ctx.user.id)
      .select("id");
    if (error) throwWrite(error, ownerKind === "student" ? "You can only file into your own subjects." : "You can only share files in subjects you teach.");
    if (!data?.length) throw new AppError("not_found", "File not found.");
    await audit(ctx, { action: "curriculum.material.attach", entityType: "curriculum_material", entityId: input.materialId, after: { share: input.share } });
    return { materialId: input.materialId, share: input.share };
  },
});

export const suggestMaterial = defineAction({
  name: "curriculum.material.suggest",
  module: "academic_structure",
  schema: SuggestMaterialSchema,
  permission: "academics.read",
  handler: async ({ materialId, suggest }: SuggestMaterialInput, ctx) => {
    if (ctx.membership.role !== "student") throw new AppError("forbidden", "Only a student suggests their own file.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("curriculum_materials")
      .update({ suggestion: suggest ? "suggested" : "none" })
      .eq("id", materialId)
      .eq("institution_id", ctx.institution.id)
      .eq("created_by", ctx.user.id)
      .not("subject_id", "is", null)
      .select("id");
    if (error) throwWrite(error, "You cannot suggest this file.");
    if (!data?.length) throw new AppError("not_found", "File not found, or not filed under a subject yet.");
    await audit(ctx, { action: suggest ? "curriculum.material.suggest" : "curriculum.material.withdraw", entityType: "curriculum_material", entityId: materialId });
    return { materialId, suggested: suggest };
  },
});

export const reviewMaterial = defineAction({
  name: "curriculum.material.review",
  module: "academic_structure",
  schema: ReviewMaterialSchema,
  permission: "resource.manage",
  handler: async ({ materialId, decision }: ReviewMaterialInput, ctx) => {
    const supabase = await createClient();
    // A suggestion is visible to exactly the people curriculum_materials_update_review lets
    // decide it (subject teacher, leaders). No RETURNING: a declined file is no longer theirs to see.
    const { data: pending, error: readError } = await supabase
      .from("curriculum_materials")
      .select("id, created_by")
      .eq("id", materialId)
      .eq("institution_id", ctx.institution.id)
      .eq("suggestion", "suggested")
      .maybeSingle();
    if (readError) throw readError;
    if (!pending || pending.created_by === ctx.user.id) throw new AppError("not_found", "No suggestion to review.");
    // The 0139 guard copies visibility to 'class' on approval and stamps the reviewer.
    const { error } = await supabase
      .from("curriculum_materials")
      .update({ suggestion: decision === "approve" ? "approved" : "declined" })
      .eq("id", materialId)
      .eq("institution_id", ctx.institution.id)
      .eq("suggestion", "suggested");
    if (error) throwWrite(error, "Only the subject's teacher or a school leader can review this.");
    await audit(ctx, { action: `curriculum.material.${decision}`, entityType: "curriculum_material", entityId: materialId });
    return { materialId, decision };
  },
});

export const deleteMaterial = defineAction({
  name: "curriculum.material.delete",
  module: "academic_structure",
  schema: MaterialIdSchema,
  permission: "academics.read",
  handler: async ({ materialId }: MaterialIdInput, ctx) => {
    const supabase = await createClient();
    // File first (same who-may rule as the row), so no live file outlives its material.
    const { error: docError } = await supabase
      .from("documents")
      .update({ status: "deleted" })
      .eq("entity_type", "curriculum_material")
      .eq("entity_id", materialId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active");
    if (docError) throwWrite(docError, "You cannot delete this file.");
    const { data, error } = await supabase.from("curriculum_materials").delete().eq("id", materialId).eq("institution_id", ctx.institution.id).select("id");
    if (error) throwWrite(error, "You cannot delete this file.");
    if (!data?.length) throw new AppError("not_found", "File not found, or you cannot delete it.");
    await audit(ctx, { action: "curriculum.material.delete", entityType: "curriculum_material", entityId: materialId });
    return { materialId };
  },
});

export const getMaterialReadUrl = defineAction({
  name: "curriculum.material.readUrl",
  module: "academic_structure",
  schema: MaterialIdSchema,
  permission: "academics.read",
  handler: async ({ materialId }: MaterialIdInput, ctx) => {
    const supabase = await createClient();
    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, path, file_name, mime")
      .eq("entity_type", "curriculum_material")
      .eq("entity_id", materialId)
      .eq("institution_id", ctx.institution.id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!doc) throw new AppError("not_found", "File not found.");
    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(doc.path, READ_URL_EXPIRES_IN);
    if (signError) throw new AppError("not_found", "File not found.");
    await audit(ctx, { action: "document.read_url", entityType: "document", entityId: doc.id });
    return { url: signed.signedUrl, expiresIn: READ_URL_EXPIRES_IN, fileName: doc.file_name, mime: doc.mime };
  },
});
