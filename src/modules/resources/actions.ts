"use server";

// resource.create / resource.attachFile / resource.publish / resource.delete (migration 0131).
// All plain table writes under RLS (teacher: own rows, taught sections; managers all). File flow:
// create (unpublished) -> documents module upload with entity type `resource` -> attachFile -> publish.
// create is AI-draftable (§E, always unpublished); publish/unpublish is a human step.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  ResourceAttachFileSchema,
  ResourceCreateSchema,
  ResourceIdSchema,
  ResourcePublishSchema,
  type ResourceAttachFileInput,
  type ResourceCreateInput,
  type ResourceIdInput,
  type ResourcePublishInput,
} from "./schemas";

const POSTGRES_RLS_VIOLATION = "42501";
const POSTGRES_FK_VIOLATION = "23503";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** RLS refusal -> forbidden, bad FK -> not_found; anything else via mapSqlError. */
function throwWriteError(error: { code?: string | null }, forbidden: string): never {
  if (error.code === POSTGRES_RLS_VIOLATION) throw new AppError("forbidden", forbidden);
  if (error.code === POSTGRES_FK_VIOLATION) throw new AppError("not_found", "Subject, unit or section not found.");
  throwMapped(error);
}

export const createResource = defineAction({
  name: "resource.create",
  module: "resources",
  schema: ResourceCreateSchema,
  permission: "resource.manage",
  handler: async (input: ResourceCreateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("resources")
      .insert({
        institution_id: ctx.institution.id,
        title: input.title,
        kind: input.kind,
        url: input.url ?? null,
        subject_id: input.subjectId,
        curriculum_unit_id: input.curriculumUnitId ?? null,
        description: input.description ?? null,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) throwWriteError(error, "You cannot add that resource.");

    if (input.classSectionIds.length > 0) {
      const { error: secError } = await supabase
        .from("resource_sections")
        .insert(input.classSectionIds.map((id) => ({ resource_id: data.id, institution_id: ctx.institution.id, class_section_id: id })));
      if (secError) {
        await supabase.from("resources").delete().eq("id", data.id);
        throwWriteError(secError, "You can only share with sections you teach.");
      }
    }

    await audit(ctx, {
      action: "resource.create",
      entityType: "resources",
      entityId: data.id,
      after: { kind: input.kind, sectionCount: input.classSectionIds.length },
    });
    return { id: data.id as string };
  },
});

export const attachResourceFile = defineAction({
  name: "resource.attachFile",
  module: "resources",
  schema: ResourceAttachFileSchema,
  permission: "resource.manage",
  handler: async ({ resourceId, documentId }: ResourceAttachFileInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("resources")
      .update({ document_id: documentId })
      .eq("id", resourceId)
      .eq("institution_id", ctx.institution.id)
      .eq("kind", "file")
      .select("id")
      .maybeSingle();
    if (error) throwWriteError(error, "You cannot change that resource.");
    // RLS hides another teacher's row, so "no row" covers not found, not yours and not a file resource.
    if (!data) throw new AppError("not_found", "File resource not found.");
    await audit(ctx, { action: "resource.attach_file", entityType: "resources", entityId: resourceId, after: { documentId } });
    return { id: resourceId };
  },
});

export const publishResource = defineAction({
  name: "resource.publish",
  module: "resources",
  schema: ResourcePublishSchema,
  permission: "resource.manage",
  handler: async ({ resourceId, published }: ResourcePublishInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("resources")
      .update({ published })
      .eq("id", resourceId)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) {
      // A file resource without an uploaded file trips resources_kind_source_check.
      if ((error as { code?: string }).code === "23514") throw new AppError("invalid_state", "Upload the file before publishing.");
      throwWriteError(error, "You cannot change that resource.");
    }
    if (!data) throw new AppError("not_found", "Resource not found.");
    await audit(ctx, { action: published ? "resource.publish" : "resource.unpublish", entityType: "resources", entityId: resourceId });
    return { id: resourceId, published };
  },
});

export const deleteResource = defineAction({
  name: "resource.delete",
  module: "resources",
  schema: ResourceIdSchema,
  permission: "resource.manage",
  handler: async ({ resourceId }: ResourceIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.from("resources").delete().eq("id", resourceId).eq("institution_id", ctx.institution.id).select("id").maybeSingle();
    if (error) throwWriteError(error, "You cannot delete that resource.");
    if (!data) throw new AppError("not_found", "Resource not found.");
    await audit(ctx, { action: "resource.delete", entityType: "resources", entityId: resourceId });
    return { id: resourceId };
  },
});
