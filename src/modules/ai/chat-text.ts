// Display helpers shared by the chat UIs (assistant panel, orb, teacher and
// student chats). Client-safe: no server imports.
import { ASSISTANT_QUERIES } from "@/modules/ai/assistant/catalog";

/** The UIs render plain text; models still emit Markdown (bold, headings, links, code) that showed raw. */
export function plainChatText(text: string): string {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1");
}

/** A finished `navigate` tool call's in-app link (assistant/tools.ts navigateTool output), else null. */
export function navigateLink(part: { type: string; state?: string; output?: unknown }): { href: string; label: string } | null {
  if (part.type !== "tool-navigate" || part.state !== "output-available") return null;
  const out = part.output as { href?: unknown; label?: unknown } | null;
  return out && typeof out.href === "string" && out.href.startsWith("/") && !out.href.startsWith("//") && typeof out.label === "string"
    ? { href: out.href, label: out.label }
    : null;
}

/** False while the latest answer holds only reasoning/tool calls so far (the "Thinking…" line stays up). */
export function lastHasText(messages: ReadonlyArray<{ role: string; parts: ReadonlyArray<{ type: string; text?: string }> }>): boolean {
  const last = messages.at(-1);
  return last?.role === "assistant" && last.parts.some((p) => p.type === "text" && Boolean(p.text));
}

/** "Records used" line: the query's plain description, not its registry id. */
export function sourceLabel(query: string): string {
  return ASSISTANT_QUERIES[query]?.description.split(":")[0] ?? query;
}

/** A registry read tool's name (dots -> underscores, agents/tools.ts toolNameFor) as its plain description, else null. */
export function readToolLabel(toolName: string): string | null {
  const key = Object.keys(ASSISTANT_QUERIES).find((k) => k.replace(/\./g, "_") === toolName);
  return key ? sourceLabel(key) : null;
}
