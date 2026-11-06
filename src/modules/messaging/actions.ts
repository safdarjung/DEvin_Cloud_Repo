"use server";

// Parent-teacher messaging actions. Writes go only through the definer RPCs
// of migration 0102 (start_message_thread / send_message / mark_thread_read),
// which re-check membership and the guardian/teacher relationship.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { createClient } from "@/lib/supabase/server";
import {
  MarkThreadReadSchema,
  SendMessageSchema,
  StartThreadSchema,
  type MarkThreadReadInput,
  type SendMessageInput,
  type StartThreadInput,
} from "@/modules/messaging/schemas";

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

export const startThread = defineAction({
  name: "messaging.startThread",
  module: "messaging",
  schema: StartThreadSchema,
  permission: "message.send",
  handler: async ({ studentId, counterpartId, subject, body }: StartThreadInput, ctx) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("start_message_thread", {
      p_institution_id: ctx.institution.id,
      p_student_id: studentId,
      p_counterpart_id: counterpartId,
      p_subject: subject,
      p_body: body,
    });
    if (error) throwMapped(error);
    return { threadId: data.id, lastMessageAt: data.last_message_at };
  },
});

export const sendMessage = defineAction({
  name: "messaging.send",
  module: "messaging",
  schema: SendMessageSchema,
  permission: "message.send",
  handler: async ({ threadId, body }: SendMessageInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("send_message", { p_thread_id: threadId, p_body: body });
    if (error) throwMapped(error);
    return { messageId: data.id, threadId: data.thread_id, createdAt: data.created_at };
  },
});

export const markThreadRead = defineAction({
  name: "messaging.markRead",
  module: "messaging",
  schema: MarkThreadReadSchema,
  permission: "message.read",
  handler: async ({ threadId }: MarkThreadReadInput) => {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("mark_thread_read", { p_thread_id: threadId });
    if (error) throwMapped(error);
    return { marked: data };
  },
});
