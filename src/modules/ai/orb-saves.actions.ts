"use server";

// The orb's recent chats and saved notes, for every role with ai.chat. Rows are the caller's own
// (study_items RLS: user_id = current user), folder "Orb". Audit records only that an item was saved
// or removed and its id, never its title or content (same rule as the student notebook).
import { AppError, mapSqlError } from "@/lib/actions/result";
import { defineAction } from "@/lib/actions/define-action";
import { audit } from "@/lib/audit";
import type { TenantContext } from "@/lib/auth/types";
import type { Json } from "@/lib/db/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { createClient } from "@/lib/supabase/server";
import { MAX_ORB_ITEMS, ORB_FOLDER, OrbChatSaveSchema, OrbItemPinSchema, OrbItemSchema, OrbListSchema, OrbNoteSaveSchema, noteBlocks } from "./orb-saves.schemas";

function aiOn(ctx: TenantContext): void {
  if (!isModuleEnabled(ctx, ctx.membership.role === "student" ? "ai_student" : "ai_teacher")) throw new AppError("ai_unavailable", "AI is switched off for this school.");
}

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function underCap(ctx: TenantContext): Promise<void> {
  const supabase = await createClient();
  const { count, error } = await supabase.from("study_items").select("id", { count: "exact", head: true }).eq("institution_id", ctx.institution.id).eq("user_id", ctx.user.id);
  if (error) throwMapped(error);
  if ((count ?? 0) >= MAX_ORB_ITEMS) throw new AppError("validation_failed", `You have ${MAX_ORB_ITEMS} saved chats and notes. Delete some to save more.`);
}

export const saveOrbChat = defineAction({
  name: "ai.orb.chat.save",
  module: "core",
  schema: OrbChatSaveSchema,
  permission: "ai.chat",
  handler: async ({ chatId, title, messages, pinned }, ctx) => {
    aiOn(ctx);
    const supabase = await createClient();
    const content = { messages } as unknown as NonNullable<Json>;
    if (chatId) {
      // RLS limits the update to the caller's own row; a stale or foreign id updates nothing and falls through to insert.
      const { data, error } = await supabase
        .from("study_items")
        .update({ title, content, ...(pinned !== undefined ? { pinned } : {}) })
        .eq("id", chatId)
        .eq("kind", "chat")
        .select("id")
        .maybeSingle();
      if (error) throwMapped(error);
      if (data) return { id: data.id as string };
    }
    await underCap(ctx);
    const { data, error } = await supabase
      .from("study_items")
      .insert({ institution_id: ctx.institution.id, user_id: ctx.user.id, kind: "chat", title, folder: ORB_FOLDER, content, pinned: pinned ?? false })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "ai.orb.chat.save", entityType: "study_item", entityId: data.id as string });
    return { id: data.id as string };
  },
});

export const saveOrbNote = defineAction({
  name: "ai.orb.note.save",
  module: "core",
  schema: OrbNoteSaveSchema,
  permission: "ai.chat",
  handler: async ({ title, text }, ctx) => {
    aiOn(ctx);
    await underCap(ctx);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_items")
      .insert({ institution_id: ctx.institution.id, user_id: ctx.user.id, kind: "note", title, folder: ORB_FOLDER, content: { blocks: noteBlocks(title, text), text } as unknown as NonNullable<Json> })
      .select("id")
      .single();
    if (error) throwMapped(error);
    await audit(ctx, { action: "ai.orb.note.save", entityType: "study_item", entityId: data.id as string });
    return { id: data.id as string };
  },
});

export interface OrbSavedItem {
  id: string;
  kind: "chat" | "note";
  title: string;
  pinned: boolean;
  updatedAt: string;
}

export const listOrbItems = defineAction({
  name: "ai.orb.items.list",
  module: "core",
  schema: OrbListSchema,
  permission: "ai.chat",
  handler: async (_input, ctx): Promise<OrbSavedItem[]> => {
    aiOn(ctx);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("study_items")
      .select("id, kind, title, pinned, updated_at")
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .eq("folder", ORB_FOLDER)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(40);
    if (error) throwMapped(error);
    return (data ?? []).map((r) => ({ id: r.id, kind: r.kind as "chat" | "note", title: r.title, pinned: r.pinned, updatedAt: r.updated_at }));
  },
});

export const getOrbItem = defineAction({
  name: "ai.orb.item.get",
  module: "core",
  schema: OrbItemSchema,
  permission: "ai.chat",
  handler: async ({ itemId }, ctx) => {
    aiOn(ctx);
    const supabase = await createClient();
    const { data, error } = await supabase.from("study_items").select("id, kind, title, content").eq("id", itemId).maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "That saved item was not found.");
    const content = data.content as { messages?: unknown[]; text?: string };
    return { id: data.id as string, kind: data.kind as "chat" | "note", title: data.title as string, messages: content.messages ?? [], text: content.text ?? "" };
  },
});

export const pinOrbItem = defineAction({
  name: "ai.orb.item.pin",
  module: "core",
  schema: OrbItemPinSchema,
  permission: "ai.chat",
  handler: async ({ itemId, pinned }, ctx) => {
    aiOn(ctx);
    const supabase = await createClient();
    const { error } = await supabase.from("study_items").update({ pinned }).eq("id", itemId);
    if (error) throwMapped(error);
    return { id: itemId, pinned };
  },
});

export const deleteOrbItem = defineAction({
  name: "ai.orb.item.delete",
  module: "core",
  schema: OrbItemSchema,
  permission: "ai.chat",
  handler: async ({ itemId }, ctx) => {
    aiOn(ctx);
    const supabase = await createClient();
    const { error } = await supabase.from("study_items").delete().eq("id", itemId);
    if (error) throwMapped(error);
    await audit(ctx, { action: "ai.orb.item.delete", entityType: "study_item", entityId: itemId });
    return { id: itemId };
  },
});
