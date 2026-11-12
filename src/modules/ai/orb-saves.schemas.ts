// The orb's own saves for every role (owner, 2026-11-12: "continue recent chats, and save a chat or
// notes or any other thing from the orb"). Stored in study_items (own rows only by RLS), folder "Orb".
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { UIMessageRequestSchema } from "@/lib/ai/ui-message-schema";

const title = z.string().trim().min(1).max(120);

export const OrbChatSaveSchema = z
  .object({
    /** The conversation's own row: updated in place on every turn; omitted for a new conversation. */
    chatId: uuid.optional(),
    title,
    // The live route's part-type denylist applies to a saved snapshot too (it is replayed on resume).
    messages: z.array(UIMessageRequestSchema).min(1).max(50),
    pinned: z.boolean().optional(),
  })
  .strict();
export const OrbNoteSaveSchema = z.object({ title, text: z.string().trim().min(1).max(12000) }).strict();
export const OrbItemSchema = z.object({ itemId: uuid }).strict();
export const OrbItemPinSchema = z.object({ itemId: uuid, pinned: z.boolean() }).strict();
export const OrbListSchema = z.object({}).strict();

export const ORB_FOLDER = "Orb";
export const MAX_ORB_ITEMS = 300;

/** A note's text as the notebook's "notes" block: one section, up to 12 bullets of at most 300 characters. */
export function noteBlocks(title: string, text: string): { kind: "notes"; sections: { heading: string; bullets: string[] }[] }[] {
  const bullets = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*\s]+/, "").trim())
    .filter(Boolean)
    .flatMap((l) => (l.length <= 300 ? [l] : l.match(/.{1,297}(\s|$)/g)?.map((x) => x.trim()) ?? [l.slice(0, 300)]))
    .slice(0, 12);
  return [{ kind: "notes", sections: [{ heading: title.slice(0, 120), bullets: bullets.length ? bullets : [text.slice(0, 300)] }] }];
}
