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
