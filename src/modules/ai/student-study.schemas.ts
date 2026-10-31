// GU-09 — student notebook (save/organize chats and notes, D32/study_items).
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";
import { UIMessageRequestSchema } from "@/lib/ai/ui-message-schema";
import { BlockSchema } from "@/modules/ai/blocks/schemas";

const title = z.string().trim().min(1).max(120);
// `null` clears the folder (moves the item to "no folder"); omitted leaves it unchanged (updateStudyItem only).
const folder = z.string().trim().min(1).max(60).nullable();

export const SaveStudyChatSchema = z
  .object({
    title,
    folder: folder.optional(),
    // Same part-type denylist as the live route (ui-message-schema.ts) —
    // a saved snapshot is replayed later (resuming the chat), so the same
    // SSRF/DoS-capable part types must be denied here too, not only on
    // the live request path.
    messages: z.array(UIMessageRequestSchema).min(1).max(50),
  })
  .strict();

export const SaveStudyNoteSchema = z
  .object({
    title,
    folder: folder.optional(),
    blocks: z.array(BlockSchema).min(1).max(5),
    sourceChatId: uuid.optional(),
  })
  .strict();

export const UpdateStudyItemSchema = z
  .object({
    itemId: uuid,
    title: title.optional(),
    folder: folder.optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((input) => input.title !== undefined || input.folder !== undefined || input.pinned !== undefined, {
    message: "Provide at least one of title, folder, or pinned.",
  });

export const DeleteStudyItemSchema = z.object({ itemId: uuid }).strict();

export type SaveStudyChatInput = z.infer<typeof SaveStudyChatSchema>;
export type SaveStudyNoteInput = z.infer<typeof SaveStudyNoteSchema>;
export type UpdateStudyItemInput = z.infer<typeof UpdateStudyItemSchema>;
export type DeleteStudyItemInput = z.infer<typeof DeleteStudyItemSchema>;
