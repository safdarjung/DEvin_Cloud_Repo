// Orb task bridge — the compact one-line task signature for the system prompt
// (design §3, about 35 tokens each). The model never sees human-only, generated
// or context fields, so it cannot be asked for them.
import { estimateTokens } from "@/lib/ai/tool-budget";
import { deriveFieldKind, schemaFields, type JsonSchemaNode } from "./derive";
import type { ClassifiedTask, FieldKind } from "./types";

const MAX_INLINE_OPTIONS = 5;

const SHORT: Readonly<Record<FieldKind, string>> = {
  enum: "enum", entity: "ref", generated: "", context: "", natural_key: "key", date: "date", datetime: "datetime", time: "time",
  rupees: "rupees", rupee_text: "rupees", paise: "rupees", marks: "marks", text: "text", long_text: "text", boolean: "bool",
  number: "num", array: "list", object: "obj", unknown: "any",
};

/** `name: Label | field:kind! field:kind` over top-level fields; "!" marks required, small enums list their values. */
export function taskSignature(name: string, task: ClassifiedTask, schema: JsonSchemaNode): string {
  const hidden = new Set([...task.humanOnly, ...task.generated, ...Object.keys(task.entities).filter((p) => task.entities[p] === "context")]);
  const parts = schemaFields(schema)
    .filter((f) => f.path.lastIndexOf("/") === 0 && !hidden.has(f.path))
    .flatMap((f) => {
      const kind = deriveFieldKind(task.module, f);
      if (!SHORT[kind]) return [];
      const options = f.node.enum ?? f.node.items?.enum;
      const type = kind === "enum" && options && options.length <= MAX_INLINE_OPTIONS ? options.join("|") : SHORT[kind];
      return [`${f.name}:${type}${f.required ? "!" : ""}`];
    });
  return `${name}: ${task.label}${parts.length ? ` | ${parts.join(" ")}` : ""}`;
}

/** Same chars/4 estimate the tool budget uses. */
export function signatureTokens(text: string): number {
  return estimateTokens(text);
}
