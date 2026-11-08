"use client";

// Shared chat UI for the read-only school assistant (POST /api/ai/agent/assistant).
// Leaders ask aggregate questions; guardians pass `studentId` for child-scoped
// answers. Answers stream in; the finish metadata lists the queries behind them.
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ActionDraftCard, isDraftToolPartType, parseDraftToolOutput } from "@/modules/ai/components/ActionDraftCard";
import { chatErrorMessage } from "@/modules/ai/chat-error";
import type { Role } from "@/lib/auth/permissions";
import { BorderBeam } from "@/components/widgets/viz";

type AssistantMessage = UIMessage<{ sources?: Array<{ query: string }> }>;

export function AssistantPanel({
  institutionSlug,
  studentId,
  previewRole,
  prompts,
  placeholder,
  initialInput,
}: {
  institutionSlug: string;
  /** Guardians only: the child the questions are about. */
  studentId?: string;
  /** Settings > AI "Test as role" only — see `handleAiChat`'s `previewRole`. */
  previewRole?: Role;
  prompts: string[];
  placeholder: string;
  /** Pre-filled question (e.g. a dashboard prompt link); the user still presses Send. */
  initialInput?: string;
}) {
  const [input, setInput] = useState(initialInput ?? "");
  const { messages, sendMessage, status, error } = useChat<AssistantMessage>({
    transport: new DefaultChatTransport({
      api: "/api/ai/agent/assistant",
      body: { institutionSlug, studentId, previewRole },
    }),
  });
  const busy = status === "submitted" || status === "streaming";

  function ask(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    void sendMessage({ text: t });
    setInput("");
  }

  return (
    <div className="space-y-3">
      <Card className="relative">
        <BorderBeam />
        <CardContent className="flex h-[60dvh] min-h-72 flex-col gap-3 overflow-y-auto p-3 text-sm sm:p-4" aria-live="polite">
          {messages.length === 0 && (
            <div className="space-y-3">
              <p className="text-muted-foreground">Answers come from your school&apos;s records. The assistant cannot change anything.</p>
              <div className="flex flex-col items-start gap-2">
                {prompts.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => ask(p)}
                    disabled={busy}
                    className="min-h-10 rounded-lg border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((message) => {
            const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
            const sources = message.role === "assistant" ? (message.metadata?.sources ?? []) : [];
            const draftParts = message.parts.filter(
              (p) => isToolUIPart(p) && p.state === "output-available" && isDraftToolPartType(p.type),
            );
            if (!text && sources.length === 0 && draftParts.length === 0) return null;
            return (
              <div
                key={message.id}
                className={
                  message.role === "user"
                    ? "max-w-[85%] self-end rounded-lg rounded-br-sm bg-primary px-3 py-2 text-primary-foreground"
                    : "min-w-0 max-w-full self-start space-y-2 rounded-lg rounded-bl-sm bg-muted px-3 py-2"
                }
              >
                {text && <p className="whitespace-pre-wrap">{text}</p>}
                {draftParts.map((part, index) => {
                  if (!isToolUIPart(part) || part.state !== "output-available") return null;
                  const parsed = parseDraftToolOutput(part.output);
                  if (!parsed) return null;
                  if ("error" in parsed) {
                    return (
                      <p key={index} role="alert" className="text-sm text-destructive">
                        {parsed.error}
                      </p>
                    );
                  }
                  return (
                    <ActionDraftCard
                      key={index}
                      institutionSlug={institutionSlug}
                      action={parsed.action}
                      input={parsed.input}
                      summary={parsed.summary}
                    />
                  );
                })}
                {sources.length > 0 && (
                  <ul className="space-y-0.5 border-t pt-2 text-xs text-muted-foreground">
                    {sources.map((s) => (
                      <li key={s.query}>Source: {s.query}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {busy && messages.at(-1)?.role !== "assistant" && (
            <div role="status" className="self-start rounded-lg rounded-bl-sm bg-muted px-3 py-2 text-xs text-muted-foreground">
              <span className="animate-pulse">Looking up records…</span>
            </div>
          )}
          {error && <ErrorState title="No answer" description={chatErrorMessage(error)} />}
        </CardContent>
      </Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] z-10 -mx-1 flex gap-2 bg-background px-1 pt-2 pb-2 lg:bottom-0"
      >
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={placeholder} disabled={busy} aria-label="Question" />
        <Button type="submit" disabled={busy || input.trim().length === 0} className="min-h-10">
          Ask
        </Button>
      </form>
    </div>
  );
}
