"use client";

// Transcript + one-line input + capability chips for the App Orb. Reuses the
// chat message shape and the draft card from the existing AI panels.
import Link from "next/link";
import { isToolUIPart, type UIMessage } from "ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ActionDraftCard, isDraftToolPartType, parseDraftToolOutput } from "@/modules/ai/components/ActionDraftCard";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";

export type OrbMessage = UIMessage<{ provider?: "local" | "cloud"; sources?: Array<{ query: string }> }>;
export interface OrbChip {
  key: string;
  label: string;
  prompt: string;
}

const VISIBLE_MESSAGES = 4;
// Teacher quiz / remark drafts have their own review editors on the AI page.
const EDITOR_DRAFT_TOOLS = new Set(["tool-generateQuiz", "tool-draftResultRemark"]);

function Message({ message, institutionSlug }: { message: OrbMessage; institutionSlug: string }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const parts = message.parts.filter((p) => isToolUIPart(p) && p.state === "output-available");
  if (!text && parts.length === 0) return null;
  const provider = message.role === "assistant" ? message.metadata?.provider : undefined;
  return (
    <div
      className={
        message.role === "user"
          ? "max-w-[85%] self-end rounded-lg rounded-br-sm bg-primary px-3 py-1.5 text-primary-foreground"
          : "min-w-0 max-w-full self-start space-y-2 rounded-lg rounded-bl-sm bg-muted px-3 py-1.5"
      }
    >
      {text && <p className="whitespace-pre-wrap">{text}</p>}
      {parts.map((part, i) => {
        if (!isToolUIPart(part) || part.state !== "output-available") return null;
        if (EDITOR_DRAFT_TOOLS.has(part.type)) {
          return (
            <Link key={i} href={`/${institutionSlug}/ai`} className="block text-xs underline">
              Review this draft in AI Assistant
            </Link>
          );
        }
        if (!isDraftToolPartType(part.type)) return null;
        const parsed = parseDraftToolOutput(part.output);
        if (!parsed) return null;
        if ("error" in parsed) return <p key={i} role="alert" className="text-sm text-destructive">{parsed.error}</p>;
        return <ActionDraftCard key={i} institutionSlug={institutionSlug} action={parsed.action} input={parsed.input} summary={parsed.summary} />;
      })}
      {provider && <ProviderBadge provider={provider} />}
    </div>
  );
}

interface Props {
  institutionSlug: string;
  messages: OrbMessage[];
  input: string;
  busy: boolean;
  chips: OrbChip[];
  error: string | null;
  onInput: (v: string) => void;
  onSend: (text: string) => void;
}

export function OrbChatPanel({ institutionSlug, messages, input, busy, chips, error, onInput, onSend }: Props) {
  return (
    <div className="relative mx-auto flex w-full max-w-xl flex-col gap-2">
      {messages.length > 0 && (
        <div className="absolute inset-x-0 bottom-full mb-2 flex max-h-56 flex-col gap-2 overflow-y-auto rounded-xl border bg-card p-2 text-sm shadow-md" aria-live="polite">
          {messages.slice(-VISIBLE_MESSAGES).map((m) => <Message key={m.id} message={m} institutionSlug={institutionSlug} />)}
        </div>
      )}
      {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
      {chips.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-1.5">
          {chips.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onSend(c.prompt)}
                className="rounded-full border bg-card px-3 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {c.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSend(input);
        }}
        className="flex gap-2"
      >
        <Input value={input} onChange={(e) => onInput(e.target.value)} placeholder="Ask anything about your role" disabled={busy} aria-label="Message" />
        <Button type="submit" disabled={busy || input.trim().length === 0}>Send</Button>
      </form>
    </div>
  );
}
