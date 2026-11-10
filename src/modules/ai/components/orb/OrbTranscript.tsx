"use client";

// The orb's conversation panel: streaming transcript, draft cards (a human
// saves; the AI never writes), provider badge (rule 7), and a clear error.
import Link from "next/link";
import { useEffect, useRef } from "react";
import { isToolUIPart, type UIMessage } from "ai";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActionDraftCard, isDraftToolPartType, parseDraftToolOutput } from "@/modules/ai/components/ActionDraftCard";
import { ProviderBadge } from "@/modules/ai/components/ProviderBadge";

export type OrbMessage = UIMessage<{ provider?: "local" | "cloud"; sources?: Array<{ query: string }> }>;

// Teacher quiz / remark drafts have their own review editors on the AI page.
const EDITOR_DRAFT_TOOLS = new Set(["tool-generateQuiz", "tool-draftResultRemark"]);

/** "tool-getAttendanceSummary" -> "get attendance summary". */
const toolName = (type: string) => type.replace(/^tool-/, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

function ToolPart({ part, institutionSlug }: { part: OrbMessage["parts"][number]; institutionSlug: string }) {
  if (!isToolUIPart(part)) return null;
  if (part.state !== "output-available") {
    if (part.state === "output-error") return null;
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-current" aria-hidden />
        Checking {toolName(part.type)}…
      </p>
    );
  }
  if (EDITOR_DRAFT_TOOLS.has(part.type)) {
    return (
      <Link href={`/${institutionSlug}/ai`} className="block text-xs font-medium underline underline-offset-2">
        Review this draft in AI Assistant
      </Link>
    );
  }
  if (!isDraftToolPartType(part.type)) return null;
  const parsed = parseDraftToolOutput(part.output);
  if (!parsed) return null;
  if ("error" in parsed) return <p role="alert" className="text-sm text-destructive">{parsed.error}</p>;
  return <ActionDraftCard institutionSlug={institutionSlug} action={parsed.action} input={parsed.input} summary={parsed.summary} />;
}

function Message({ message, institutionSlug, streaming }: { message: OrbMessage; institutionSlug: string; streaming: boolean }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const tools = message.parts.filter((p) => isToolUIPart(p));
  if (!text && tools.length === 0) return null;
  if (message.role === "user") {
    return <p className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3 py-2 text-primary-foreground">{text}</p>;
  }
  const provider = message.metadata?.provider;
  return (
    <div className="min-w-0 max-w-full space-y-2">
      {tools.map((part, i) => <ToolPart key={i} part={part} institutionSlug={institutionSlug} />)}
      {text && (
        <p className="whitespace-pre-wrap leading-relaxed">
          {text}
          {streaming && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground" aria-hidden />}
        </p>
      )}
      {provider && <ProviderBadge provider={provider} />}
    </div>
  );
}

interface Props {
  institutionSlug: string;
  messages: OrbMessage[];
  status: string;
  error: string | null;
  accent: string;
  onRetry: () => void;
  onDismissError: () => void;
  onNewChat: () => void;
  onCollapse: () => void;
}

export function OrbTranscript({ institutionSlug, messages, status, error, accent, onRetry, onDismissError, onNewChat, onCollapse }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);
  const answerShown = last?.role === "assistant" && last.parts.some((p) => (p.type === "text" && p.text) || isToolUIPart(p));
  const thinking = status === "submitted" || (status === "streaming" && !answerShown);
  const label = error ? "Error" : thinking ? "Thinking…" : status === "streaming" ? "Answering…" : "Ready";

  // Keep the newest text in view while it streams.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status, error]);

  return (
    <section aria-label="Conversation" className="flex size-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.35)] backdrop-blur">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="size-2 rounded-full" style={{ background: error ? "var(--destructive)" : accent }} aria-hidden />
        <h2 className="text-sm font-semibold">Conversation</h2>
        <span className="text-xs text-muted-foreground">{label}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onNewChat} aria-label="Start a new conversation" title="New conversation">
            <RotateCcw />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onCollapse} aria-label="Hide conversation" title="Hide">
            <ChevronDown />
          </Button>
        </div>
      </header>
      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 text-sm" aria-live="polite">
        {messages.map((m) => (
          <Message key={m.id} message={m} institutionSlug={institutionSlug} streaming={status === "streaming" && m === last} />
        ))}
        {thinking && (
          <p className="flex items-center gap-1 text-muted-foreground" aria-label="Thinking">
            {[0, 150, 300].map((d) => (
              <span key={d} className="size-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${d}ms` }} aria-hidden />
            ))}
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="flex items-center gap-1.5 font-medium text-destructive">
              <TriangleAlert className="size-4" aria-hidden />
              Couldn&apos;t get an answer
            </p>
            <p className="mt-1 text-muted-foreground">{error}</p>
            <div className="mt-2 flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>Try again</Button>
              <Button type="button" size="sm" variant="ghost" onClick={onDismissError}>Dismiss</Button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
