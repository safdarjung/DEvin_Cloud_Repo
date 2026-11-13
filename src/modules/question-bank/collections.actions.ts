"use server";

// 0146 — question_collections: a staff member's own named sets of bank
// questions, private or shared with the school. RLS does the scoping: only
// the owner writes a collection or its items, and an item's question must be
// one the caller can read in question_bank. 0 rows on update/delete ->
// not_found (not yours, or gone).
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import {
  CollectionCreateSchema,
  CollectionItemsSchema,
  CollectionUpdateSchema,
  QuestionIdSchema,
  type CollectionCreateInput,
  type CollectionItemsInput,
  type CollectionUpdateInput,
  type QuestionIdInput,
} from "@/modules/question-bank/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const createCollection = defineAction({
  name: "questionCollection.create",
  module: "question_bank",
  schema: CollectionCreateSchema,
  permission: "question.manage",
  handler: async ({ name, description, visibility }: CollectionCreateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("question_collections")
      .insert({ institution_id: ctx.institution.id, owner_id: ctx.user.id, name, description: description ?? null, visibility })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "question_collection.create", entityType: "question_collection", entityId: data.id });
    return { id: data.id as string };
  },
});

export const updateCollection = defineAction({
  name: "questionCollection.update",
  module: "question_bank",
  schema: CollectionUpdateSchema,
  permission: "question.manage",
  handler: async ({ id, name, description, visibility }: CollectionUpdateInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("question_collections")
      .update({ name, description, visibility })
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .eq("owner_id", ctx.user.id)
      .select("id, visibility")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Collection not found.");
    await audit(ctx, { action: "question_collection.update", entityType: "question_collection", entityId: id, after: { visibility: data.visibility } });
    return { id, visibility: data.visibility as "private" | "school" };
  },
});

export const deleteCollection = defineAction({
  name: "questionCollection.delete",
  module: "question_bank",
  schema: QuestionIdSchema,
  permission: "question.manage",
  handler: async ({ id }: QuestionIdInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("question_collections")
      .delete()
      .eq("id", id)
      .eq("institution_id", ctx.institution.id)
      .eq("owner_id", ctx.user.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Collection not found.");
    await audit(ctx, { action: "question_collection.delete", entityType: "question_collection", entityId: id });
    return { id };
  },
});

export const addToCollection = defineAction({
  name: "questionCollection.addItems",
  module: "question_bank",
  schema: CollectionItemsSchema,
  permission: "question.manage",
  handler: async ({ collectionId, questionIds }: CollectionItemsInput, ctx) => {
    const supabase = await createClient();
    const { data: own, error: ownError } = await supabase
      .from("question_collections")
      .select("id")
      .eq("id", collectionId)
      .eq("institution_id", ctx.institution.id)
      .eq("owner_id", ctx.user.id)
      .maybeSingle();
    if (ownError) throwMapped(ownError);
    if (!own) throw new AppError("not_found", "Collection not found.");

    const rows = [...new Set(questionIds)].map((questionId) => ({
      collection_id: collectionId,
      question_id: questionId,
      institution_id: ctx.institution.id,
      added_by: ctx.user.id,
    }));
    const { data, error } = await supabase
      .from("question_collection_items")
      .upsert(rows, { onConflict: "collection_id,question_id", ignoreDuplicates: true })
      .select("question_id");
    if (error) throwMapped(error);
    await audit(ctx, { action: "question_collection.add_items", entityType: "question_collection", entityId: collectionId, metadata: { count: rows.length } });
    return { collectionId, added: (data ?? []).length };
  },
});

export const removeFromCollection = defineAction({
  name: "questionCollection.removeItems",
  module: "question_bank",
  schema: CollectionItemsSchema,
  permission: "question.manage",
  handler: async ({ collectionId, questionIds }: CollectionItemsInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("question_collection_items")
      .delete()
      .eq("collection_id", collectionId)
      .eq("institution_id", ctx.institution.id)
      .in("question_id", questionIds)
      .select("question_id");
    if (error) throwMapped(error);
    await audit(ctx, { action: "question_collection.remove_items", entityType: "question_collection", entityId: collectionId, metadata: { count: (data ?? []).length } });
    return { collectionId, removed: (data ?? []).length };
  },
});
