import "server-only";
// GU-09 — notebook reads. Always the signed-in user's RLS client; RLS
// (study_items_select, 0049) already scopes every query here to the
// caller's own rows — these filters are the list/search UX, not the
// security boundary.
import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import { UIMessageRequestSchema } from "@/lib/ai/ui-message-schema";
import { BlockSchema, type Block } from "@/modules/ai/blocks/schemas";

export interface StudyItemSummary {
  id: string;
  kind: "chat" | "note";
  title: string;
  folder: string | null;
  pinned: boolean;
  updatedAt: string;
}

interface StudyItemRow {
  id: string;
  kind: string;
  title: string;
  folder: string | null;
  pinned: boolean;
  updated_at: string;
}

function toSummary(row: StudyItemRow): StudyItemSummary {
  return {
    id: row.id,
    kind: row.kind === "chat" ? "chat" : "note",
    title: row.title,
    folder: row.folder,
    pinned: row.pinned,
    updatedAt: row.updated_at,
  };
}

export async function listStudyItems(
  ctx: TenantContext,
  filter: { folder?: string; search?: string } = {},
): Promise<StudyItemSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("study_items")
    .select("id, kind, title, folder, pinned, updated_at")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .order("pinned", { ascending: false })
    .order("updated_at", { ascending: false });

  if (filter.folder) query = query.eq("folder", filter.folder);
  if (filter.search) query = query.ilike("title", `%${filter.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(toSummary);
}

/** Distinct folder names in use, for the notebook's folder filter — alphabetical, never-foldered items excluded. */
export async function listStudyFolders(ctx: TenantContext): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_items")
    .select("folder")
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .not("folder", "is", null);
  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.folder as string))].sort();
}

export interface StudyChatDetail extends StudyItemSummary {
  kind: "chat";
  messages: UIMessage[];
}

export interface StudyNoteDetail extends StudyItemSummary {
  kind: "note";
  blocks: Block[];
}

export type StudyItemDetail = StudyChatDetail | StudyNoteDetail;

export async function getStudyItem(ctx: TenantContext, itemId: string): Promise<StudyItemDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("study_items")
    .select("id, kind, title, folder, pinned, updated_at, content")
    .eq("id", itemId)
    .eq("institution_id", ctx.institution.id)
    .eq("user_id", ctx.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const summary = toSummary(data);
  if (data.kind === "chat") {
    // Security review (L3) — re-validated on read, same reasoning as the
    // note branch below: a row written through the Data API directly (RLS
    // permits it; only this app's own save action runs Zod first) could
    // hold a malformed `messages` shape, and `.map()`-ing a message with
    // no `parts` array would crash StudyChat's render of this student's
    // own `?resume=` page. IMPORTANT: this is the stored snapshot only —
    // it still passes through the live route's own `stripToUserText`
    // before ever reaching a model on the next send, same as any other
    // client-supplied history; nothing here sends it to a model directly.
    const content = data.content as { messages?: unknown } | null;
    const parsedMessages = UIMessageRequestSchema.array().safeParse(content?.messages);
    const messages = parsedMessages.success ? parsedMessages.data : [];
    return { ...summary, kind: "chat", messages: messages as unknown as UIMessage[] };
  }

  // Note blocks are re-validated on read (not just at save): a row could
  // predate a later change to the block catalog's schema, and a renderer
  // should degrade to "nothing shown" rather than crash on a stale shape.
  const content = data.content as { blocks?: unknown } | null;
  const parsed = Array.isArray(content?.blocks) ? content.blocks.map((b) => BlockSchema.safeParse(b)) : [];
  const blocks = parsed.filter((p): p is { success: true; data: Block } => p.success).map((p) => p.data);
  return { ...summary, kind: "note", blocks };
}
