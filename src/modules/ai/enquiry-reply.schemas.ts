// Admissions enquiry-reply draft schemas (07 §5, mirrors
// src/modules/ai/quiz.schemas.ts's shape — one short string field, capped
// well under the 2000-ish Ollama JSON-Schema-to-grammar crash threshold
// quiz.schemas.ts documents).
import { z } from "zod";
import { uuid } from "@/lib/schemas/common";

export const ENQUIRY_REPLY_MAX_LENGTH = 500;

export const EnquiryReplySchema = z
  .object({
    reply: z.string().trim().min(1).max(ENQUIRY_REPLY_MAX_LENGTH),
  })
  .strict();

export type EnquiryReplyContent = z.infer<typeof EnquiryReplySchema>;

export const EnquiryReplyRequestSchema = z
  .object({
    institutionSlug: z.string().trim().min(1).max(100),
    enquiryId: uuid,
  })
  .strict();

export type EnquiryReplyRequestInput = z.infer<typeof EnquiryReplyRequestSchema>;
