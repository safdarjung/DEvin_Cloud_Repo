"use server";

// GU-09 — the notebook: save/organize chats and notes (D32's own-rows
// study_items/study_preferences, GU-07). Every action here is `ai.study`
// (student only, 07 §2.2) plus the `student_ai_notebook` entitlement
// (D33, a child of `student_ai_study`) — RLS (own rows, no staff
// exception, GU-07) is the real backstop either way.
//
// Audit note (gateway.ts security review, L9, carried forward here):
// `audit_events` is readable by owner/principal/admin (07 §2.2
// `audit.read`) — D32 says no staff role may see a student's study
// *content*, so these audit calls record only that a save/update/delete
// happened and which item, never the title or the content itself.
import { revalidatePath } from "next/cache";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { defineAction } from "@/lib/actions/define-action";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/db/types";

type StudyItemUpdate = Database["public"]["Tables"]["study_items"]["Update"];
type StudyItemInsert = Database["public"]["Tables"]["study_items"]["Insert"];
import {
  DeleteStudyItemSchema,
  SaveStudyChatSchema,
  SaveStudyNoteSchema,
  UpdateStudyItemSchema,
  UpdateStudyLanguageSchema,
} from "@/modules/ai/student-study.schemas";

// A generous ceiling, not a product decision about how much a student
// "should" save — just a backstop against unbounded growth (DBT-18's own
// reasoning, applied here). Revisit from real usage once GU-11 seeds a
// demo notebook.
const MAX_ITEMS_PER_STUDENT = 200;

type StudyClient = Awaited<ReturnType<typeof createClient>>;

function requireNotebookEnabled(ctx: TenantContext): void {
  if (!isAiCapabilityEnabled(ctx, "study_notebook")) {
    throw new AppError("ai_unavailable", "Your school has switched the notebook off.");
  }
}

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

async function assertUnderItemCap(supabase: StudyClient, ctx: TenantContext): Promise<void> {
  const { count, error } = await supabase
    .from("study_items")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id);
  if (error) throwMapped(error);
  if ((count ?? 0) >= MAX_ITEMS_PER_STUDENT) {
    throw new AppError(
      "validation_failed",
      `You've reached the saved items limit (${MAX_ITEMS_PER_STUDENT}). Delete something to save more.`,
    );
  }
}

export const saveStudyChat = defineAction({
  name: "ai.study.chat.save",
  module: "ai_student",
  schema: SaveStudyChatSchema,
  permission: "ai.study",
  handler: async ({ title, folder, messages }, ctx) => {
    requireNotebookEnabled(ctx);
    const supabase = await createClient();
    await assertUnderItemCap(supabase, ctx);

    const { data, error } = await supabase
      .from("study_items")
      .insert({
        institution_id: ctx.institution.id,
        user_id: ctx.user.id,
        kind: "chat",
        title,
        folder: folder ?? null,
        content: { messages } as unknown as NonNullable<Json>,
      })
      .select("id")
      .single();
    if (error) throwMapped(error);

    await audit(ctx, { action: "ai.study.chat.save", entityType: "study_item", entityId: data.id as string });
    revalidatePath(`/${ctx.institution.slug}/portal/study/notebook`);
    return { id: data.id as string };
  },
});

export const saveStudyNote = defineAction({
  name: "ai.study.note.save",
  module: "ai_student",
  schema: SaveStudyNoteSchema,
  permission: "ai.study",
  handler: async ({ title, folder, blocks, sourceChatId }, ctx) => {
    requireNotebookEnabled(ctx);
    const supabase = await createClient();
    await assertUnderItemCap(supabase, ctx);

    const insert: StudyItemInsert = {
      institution_id: ctx.institution.id,
      user_id: ctx.user.id,
      kind: "note",
      title,
      folder: folder ?? null,
      content: { blocks } as unknown as NonNullable<Json>,
    };
    // Security review (L1): resolved through the caller's own RLS client,
    // so ownership is enforced by the same policy that scopes every other
    // read here — a stale, someone-else's, wrong-institution, or wrong-
    // kind (note, not chat) id is silently dropped rather than linked or
    // surfaced as an error (no existence oracle on this optional field).
    if (sourceChatId) {
      const { data: chat } = await supabase.from("study_items").select("id").eq("id", sourceChatId).eq("kind", "chat").maybeSingle();
      if (chat) insert.source_chat_id = sourceChatId;
    }

    const { data, error } = await supabase.from("study_items").insert(insert).select("id").single();
    if (error) throwMapped(error);

    await audit(ctx, { action: "ai.study.note.save", entityType: "study_item", entityId: data.id as string });
    revalidatePath(`/${ctx.institution.slug}/portal/study/notebook`);
    return { id: data.id as string };
  },
});

export const updateStudyItem = defineAction({
  name: "ai.study.item.update",
  module: "ai_student",
  schema: UpdateStudyItemSchema,
  permission: "ai.study",
  handler: async ({ itemId, title, folder, pinned }, ctx) => {
    requireNotebookEnabled(ctx);
    const supabase = await createClient();

    const patch: StudyItemUpdate = {};
    if (title !== undefined) patch.title = title;
    if (folder !== undefined) patch.folder = folder;
    if (pinned !== undefined) patch.pinned = pinned;

    // RLS (study_items_update, 0049) already scopes this to the caller's
    // own row; the explicit institution_id/user_id filters (security
    // review L2) are defense in depth, matching queries.ts's own pattern
    // — without them, a route/action bug elsewhere in this institution's
    // own code could reach across a student's other-institution rows (RLS
    // alone still blocks it, but the query shouldn't rely on that twice).
    // A mismatched id simply updates nothing (0 rows), not an error.
    const { data, error } = await supabase
      .from("study_items")
      .update(patch)
      .eq("id", itemId)
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Item not found, or not yours.");

    await audit(ctx, { action: "ai.study.item.update", entityType: "study_item", entityId: itemId });
    revalidatePath(`/${ctx.institution.slug}/portal/study/notebook`);
    return { id: itemId };
  },
});

export const deleteStudyItem = defineAction({
  name: "ai.study.item.delete",
  module: "ai_student",
  schema: DeleteStudyItemSchema,
  permission: "ai.study",
  handler: async ({ itemId }, ctx) => {
    requireNotebookEnabled(ctx);
    const supabase = await createClient();

    // Security review (L2) — same explicit institution/user scoping as updateStudyItem above.
    const { data, error } = await supabase
      .from("study_items")
      .delete()
      .eq("id", itemId)
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Item not found, or not yours.");

    await audit(ctx, { action: "ai.study.item.delete", entityType: "study_item", entityId: itemId });
    revalidatePath(`/${ctx.institution.slug}/portal/study/notebook`);
    return { id: itemId };
  },
});

// DBT-160 — own-row upsert (RLS: own rows only); keeps any other style keys.
export const updateStudyLanguage = defineAction({
  name: "ai.study.language.update",
  module: "ai_student",
  schema: UpdateStudyLanguageSchema,
  permission: "ai.study",
  handler: async ({ language }, ctx) => {
    const supabase = await createClient();
    const { data: existing, error: readError } = await supabase
      .from("study_preferences")
      .select("style")
      .eq("institution_id", ctx.institution.id)
      .eq("user_id", ctx.user.id)
      .maybeSingle();
    if (readError) throwMapped(readError);
    const style = typeof existing?.style === "object" && existing.style !== null && !Array.isArray(existing.style) ? existing.style : {};

    const { error } = await supabase.from("study_preferences").upsert(
      {
        institution_id: ctx.institution.id,
        user_id: ctx.user.id,
        style: { ...style, language } as unknown as NonNullable<Json>,
      },
      { onConflict: "institution_id,user_id" },
    );
    if (error) throwMapped(error);

    await audit(ctx, { action: "ai.study.language.update", entityType: "study_preferences", entityId: ctx.user.id });
    revalidatePath(`/${ctx.institution.slug}/portal/study`);
    return { language };
  },
});
