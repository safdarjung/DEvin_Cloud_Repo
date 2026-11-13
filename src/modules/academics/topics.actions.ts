"use server";

// 0147 — curriculum.topic.upsert / curriculum.topic.delete. Same permission
// and RLS roles as curriculum.unit.upsert (owner/principal/admin). Depth is
// unit -> topic -> subtopic: a parent must itself be a top-level topic of the
// same unit (same unit is also enforced by the composite FK). Deleting a
// topic deletes its subtopics; questions keep their row (topic set null).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { TopicDeleteSchema, TopicUpsertSchema, type TopicDeleteInput, type TopicUpsertInput } from "@/modules/academics/curriculum.schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const upsertTopic = defineAction({
  name: "curriculum.topic.upsert",
  module: "academic_structure",
  schema: TopicUpsertSchema,
  permission: "academics.manage",
  handler: async ({ id, curriculumUnitId, parentId, title, sequence }: TopicUpsertInput, ctx) => {
    const supabase = await createClient();
    if (parentId) {
      const { data: parent, error } = await supabase
        .from("curriculum_topics")
        .select("id, parent_id, curriculum_unit_id")
        .eq("id", parentId)
        .eq("institution_id", ctx.institution.id)
        .maybeSingle();
      if (error) throwMapped(error);
      if (!parent || parent.curriculum_unit_id !== curriculumUnitId) throw new AppError("not_found", "Parent topic not found in this unit.");
      if (parent.parent_id !== null || parent.id === id) {
        throw new AppError("validation_failed", "A subtopic cannot have its own subtopics.", { parentId: ["Pick a top-level topic."] });
      }
      if (id) {
        const { count, error: childError } = await supabase
          .from("curriculum_topics")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", id);
        if (childError) throwMapped(childError);
        if (count) throw new AppError("validation_failed", "This topic has subtopics, so it cannot become a subtopic.", { parentId: ["Move its subtopics first."] });
      }
    }

    const query = id
      ? supabase
          .from("curriculum_topics")
          .update({ parent_id: parentId ?? null, title, sequence })
          .eq("id", id)
          .eq("institution_id", ctx.institution.id)
          .eq("curriculum_unit_id", curriculumUnitId)
      : supabase
          .from("curriculum_topics")
          .insert({ institution_id: ctx.institution.id, curriculum_unit_id: curriculumUnitId, parent_id: parentId ?? null, title, sequence });
    const { data, error } = await query.select("id").maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Topic not found.");

    await audit(ctx, { action: "curriculum.topic.upsert", entityType: "curriculum_topic", entityId: data.id });
    return { id: data.id as string };
  },
});

export const deleteTopic = defineAction({
  name: "curriculum.topic.delete",
  module: "academic_structure",
  schema: TopicDeleteSchema,
  permission: "academics.manage",
  handler: async ({ id }: TopicDeleteInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("curriculum_topics")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Topic not found.");
    await audit(ctx, { action: "curriculum.topic.delete", entityType: "curriculum_topic", entityId: id });
    return { id };
  },
});
