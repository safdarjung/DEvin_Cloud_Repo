// D28/GU-08 — shared request-body validation for every multi-turn chat
// agent route (teacher, student). Extracted here after the teacher route
// hit the same class of bug three times while this logic lived only in
// that one file (12-decision-log.md D28's "fix round 3" note): an
// ALLOWLIST of part types can't anticipate every legitimate SDK-emitted
// type (TextUIPart's own echoed `state`/`providerMetadata`, then the
// `reasoning` part type). The real boundary is narrower than "every type
// we didn't think of" — only types that carry a `url`/fetchable content
// field the AI SDK downloads server-side (FileUIPart, SourceUrlUIPart,
// SourceDocumentUIPart, ReasoningFileUIPart) or are free-form payloads a
// server never itself emits (`data-*`, DataUIPart) are denied; everything
// else passes through `.passthrough()`. A single shared schema means a
// fourth occurrence of this bug can only happen once, not once per route.
import { z } from "zod";
import type { UIMessage } from "ai";

const DENIED_PART_TYPES = new Set(["file", "source-url", "source-document", "reasoning-file"]);

export const UIMessagePartSchema = z
  .object({ type: z.string().max(100) })
  .passthrough()
  .refine(
    (part) => !DENIED_PART_TYPES.has(part.type) && !part.type.startsWith("data-"),
    { message: "This message part type is not allowed." },
  )
  .refine((part) => part.type !== "text" || (typeof part.text === "string" && part.text.length <= 4000), {
    message: "A text part must be a string of at most 4000 characters.",
  });

export const UIMessageRequestSchema = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "system"]),
    parts: z.array(UIMessagePartSchema).min(1).max(50),
  })
  .passthrough();

// M24-T1 — extract text-only history for models, dropping system messages
// and all non-text parts (tool calls, reasoning). A message left with zero
// text parts is dropped entirely.
export function stripToText(messages: z.infer<typeof UIMessageRequestSchema>[]): UIMessage[] {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      ...message,
      parts: message.parts.filter((part): part is { type: "text"; text: string } => part.type === "text"),
    }))
    .filter((message) => message.parts.length > 0) as unknown as UIMessage[];
}

// M24-T1 — extract text parts from the most recent user message for
// provider routing and redaction policy decisions. Returns undefined if
// no user message exists; returns an empty string if the last user message
// has no text parts.
export function latestUserText(messages: z.infer<typeof UIMessageRequestSchema>[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    return message.parts
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(" ");
  }
  return undefined;
}
