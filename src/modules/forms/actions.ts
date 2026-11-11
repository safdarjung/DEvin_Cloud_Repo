"use server";

// form.create / form.update / form.publish / form.close / form.respond (migration 0122).
// Drafts are plain table writes under RLS; publish/close go through the guard trigger's status
// machine; respond only through public.submit_form_response. Create/update are AI-draftable (§E);
// publish, close and respond are human steps.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  FormCreateSchema,
  FormIdSchema,
  FormRespondSchema,
  FormUpdateSchema,
  type FormCreateInput,
  type FormIdInput,
  type FormRespondInput,
  type FormUpdateInput,
} from "./schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

/** Plain-write errors: RLS refusal on a section/form -> forbidden, bad FK -> not_found; anything else via mapSqlError. */
function throwWriteError(error: { code?: string | null }): never {
  if (error.code === "42501") throw new AppError("forbidden", "You cannot change that form or section.");
  if (error.code === "23503") throw new AppError("not_found", "Section not found.");
  throwMapped(error);
}

export const createForm = defineAction({
  name: "form.create",
  module: "forms",
  schema: FormCreateSchema,
  permission: "form.manage",
  handler: async (input: FormCreateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("forms")
      .insert({
        institution_id: ctx.institution.id,
        title: input.title,
        description: input.description || null,
        fields: input.fields,
        created_by: ctx.user.id,
      })
      .select("id")
      .single();
    if (error) throwWriteError(error);

    if (input.classSectionIds.length > 0) {
      const { error: secError } = await supabase.from("form_sections").insert(
        input.classSectionIds.map((id) => ({ form_id: data.id, institution_id: ctx.institution.id, class_section_id: id })),
      );
      if (secError) {
        await supabase.from("forms").delete().eq("id", data.id);
        throwWriteError(secError);
      }
    }

    await audit(ctx, {
      action: "form.create",
      entityType: "forms",
      entityId: data.id,
      after: { fieldCount: input.fields.length, sectionCount: input.classSectionIds.length },
    });
    return { id: data.id as string };
  },
});

export const updateForm = defineAction({
  name: "form.update",
  module: "forms",
  schema: FormUpdateSchema,
  permission: "form.manage",
  handler: async (input: FormUpdateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("forms")
      .update({ title: input.title, description: input.description || null, fields: input.fields })
      .eq("id", input.formId)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwWriteError(error);
    if (!data) throw new AppError("not_found", "Form not found.");

    // Sections: delete + insert (no update policy). Both are refused by RLS once the form is not a draft.
    const { error: delError } = await supabase.from("form_sections").delete().eq("form_id", input.formId);
    if (delError) throwWriteError(delError);
    if (input.classSectionIds.length > 0) {
      const { error: secError } = await supabase.from("form_sections").insert(
        input.classSectionIds.map((id) => ({ form_id: input.formId, institution_id: ctx.institution.id, class_section_id: id })),
      );
      if (secError) throwWriteError(secError);
    }

    await audit(ctx, {
      action: "form.update",
      entityType: "forms",
      entityId: input.formId,
      after: { fieldCount: input.fields.length, sectionCount: input.classSectionIds.length },
    });
    return { id: input.formId };
  },
});

async function setStatus(ctx: Parameters<Parameters<typeof defineAction>[0]["handler"]>[1], formId: string, status: "published" | "closed") {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forms")
    .update({ status })
    .eq("id", formId)
    .eq("institution_id", ctx.institution.id)
    .select("id")
    .maybeSingle();
  if (error) throwWriteError(error);
  if (!data) throw new AppError("not_found", "Form not found.");
  await audit(ctx, { action: status === "published" ? "form.publish" : "form.close", entityType: "forms", entityId: formId, after: { status } });
  return { id: formId };
}

export const publishForm = defineAction({
  name: "form.publish",
  module: "forms",
  schema: FormIdSchema,
  permission: "form.manage",
  handler: (input: FormIdInput, ctx) => setStatus(ctx, input.formId, "published"),
});

export const closeForm = defineAction({
  name: "form.close",
  module: "forms",
  schema: FormIdSchema,
  permission: "form.manage",
  handler: (input: FormIdInput, ctx) => setStatus(ctx, input.formId, "closed"),
});

export const respondToForm = defineAction({
  name: "form.respond",
  module: "forms",
  schema: FormRespondSchema,
  permission: "form.respond",
  handler: async (input: FormRespondInput) => {
    const supabase = await createClient();
    const { error } = await supabase.rpc("submit_form_response", {
      p_form_id: input.formId,
      p_student_id: input.studentId as string,
      p_answers: input.answers,
    });
    if (error) throwMapped(error);
    return { formId: input.formId };
  },
});
