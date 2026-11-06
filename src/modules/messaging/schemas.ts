// Parent-teacher messaging schemas (migration 0102). Every object is .strict().
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

const messageBody = z.string().trim().min(1).max(4000);

/** Guardian caller: counterpartId = teacher staff id. Teacher caller: counterpartId = guardian id. */
export const StartThreadSchema = z
  .object({
    studentId: uuid,
    counterpartId: uuid,
    subject: z.string().trim().min(1).max(200),
    body: messageBody,
  })
  .strict();
export type StartThreadInput = z.infer<typeof StartThreadSchema>;

export const SendMessageSchema = z.object({ threadId: uuid, body: messageBody }).strict();
export type SendMessageInput = z.infer<typeof SendMessageSchema>;

export const MarkThreadReadSchema = z.object({ threadId: uuid }).strict();
export type MarkThreadReadInput = z.infer<typeof MarkThreadReadSchema>;

export const MyThreadsSchema = z.object({ studentId: uuid.optional() }).strict();
export type MyThreadsInput = z.infer<typeof MyThreadsSchema>;

export const ThreadMessagesSchema = z.object({ threadId: uuid }).strict();
export type ThreadMessagesInput = z.infer<typeof ThreadMessagesSchema>;

export const MessageableTeachersSchema = z.object({ studentId: uuid }).strict();
export type MessageableTeachersInput = z.infer<typeof MessageableTeachersSchema>;
