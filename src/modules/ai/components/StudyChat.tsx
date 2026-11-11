"use client";

// GU-08/GU-09 — client chat UI for the student study agent, plus the
// notebook's "save" entry points (save chat, make notes, save a note).
// The honesty banner below is hardcoded to the local-only wording (not a
// provider choice like TeacherAgentChat's) because D32 makes that the
// only reachable path in this build: `streamAgent` refuses the cloud
// step outright (GU-05), and `student_ai_study` itself requires
// `ai_policy: "local_only"` — showing a cloud-sounding badge here would
// describe a path that cannot run yet.
import Link from "next/link";
import { Info } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BlockRenderer } from "@/modules/ai/blocks/BlockRenderer";
import { BlockSchema, type Block } from "@/modules/ai/blocks/schemas";
import { ActionDraftCard, isDraftToolPartType, parseDraftToolOutput } from "@/modules/ai/components/ActionDraftCard";
import { chatErrorMessage } from "@/modules/ai/chat-error";
import { lastHasText, plainChatText, readToolLabel } from "@/modules/ai/chat-text";
import type { StudentSkill } from "@/modules/ai/prompts/student-skills";
import { saveStudyChat, saveStudyNote } from "@/modules/ai/student-study.actions";
import { BorderBeam } from "@/components/widgets/viz";

interface StudyChatProps {
  institutionSlug: string;
  skills: StudentSkill[];
  notebookEnabled: boolean;
  /** Resuming a saved chat (GU-09: "reopening seeds useChat({ messages })") — omitted for a fresh session. */
  initialMessages?: UIMessage[];
  /** The saved chat item's own id, when resuming — new notes made in this session reference it as `sourceChatId`. */
  resumedChatId?: string;
  /** Where the page header's back link goes. */
  backHref?: string;
  /** Which engine answers (server decides from configured keys) — drives the disclosure line. */
  aiMode?: "cloud" | "local";
}

const TOOL_LABELS: Record<string, string> = {
  findMyCurriculumUnit: "Looking up the topic…",
  showStudyBlocks: "Preparing visuals…",
};

function toolLabel(type: string): string {
  const name = type.startsWith("tool-") ? type.slice(5) : type;
  const read = readToolLabel(name);
  return TOOL_LABELS[name] ?? (read ? `Checking: ${read}…` : `Using ${name}…`);
}

const ShowStudyBlocksInputSchema = z.object({ blocks: z.array(BlockSchema).min(1).max(5) });

const SKILL_CHIP_LABELS: Record<StudentSkill, string> = {
  terse: "Short",
  eli5: "Simple (ELI5)",
  anatomy: "Parts (Anatomy)",
};

function SkillChips({ skills }: { skills: StudentSkill[] }) {
  if (skills.length === 0) return null;
  // Plan §8's exact honesty-label wording — the student must know their
  // replies are being simplified (ELI5/terse), not left to guess.
  return (
    <p className="text-muted-foreground text-xs">
      Style: {skills.map((skill) => SKILL_CHIP_LABELS[skill]).join(" · ")}
    </p>
  );
}

interface SaveAsNoteProps {
  institutionSlug: string;
  blocks: Block[];
  sourceChatId?: string;
}

/** GU-09 — "Save as note": an inline title prompt, then the real saveStudyNote action (re-validates server-side regardless of this component). */
function SaveAsNote({ institutionSlug, blocks, sourceChatId }: SaveAsNoteProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    const result = await saveStudyNote(institutionSlug, { title: trimmed, blocks, sourceChatId });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSaved(true);
    setEditing(false);
  }

  if (saved) return <p className="text-muted-foreground text-xs">Saved to your notebook.</p>;

  if (!editing) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
        Save as note
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Note title"
        maxLength={120}
        autoFocus
      />
      <Button type="button" size="sm" onClick={handleSave} disabled={saving || title.trim().length === 0}>
        {saving ? "Saving…" : "Save"}
      </Button>
      {error && <p role="alert" className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function MessageParts({ message, institutionSlug, resumedChatId }: { message: UIMessage; institutionSlug: string; resumedChatId?: string }) {
  return (
    <>
      {message.parts.map((part, index) => {
        if (part.type === "text") {
          return (
            <p key={index} className="whitespace-pre-wrap">
              {plainChatText(part.text)}
            </p>
          );
        }
        if (isToolUIPart(part)) {
          const label = toolLabel(part.type);
          const done = part.state === "output-available" || part.state === "output-error";
          const statusLine = (
            <div className="border-l-2 pl-2 text-xs italic text-muted-foreground">
              {done ? label.replace("…", " — done.") : label}
              {part.state === "output-error" && part.errorText ? ` (${part.errorText})` : ""}
            </div>
          );

          // `showStudyBlocks`'s content is in the tool call's own INPUT
          // (what the model decided to show), not its output — "validated
          // echo" (student-tools.ts): re-parsed here too, client-side,
          // before BlockRenderer ever sees it, rather than trusting the
          // SDK's own client-side type narrowing alone.
          if (part.type === "tool-showStudyBlocks" && (part.state === "input-available" || part.state === "output-available")) {
            const parsed = ShowStudyBlocksInputSchema.safeParse(part.input);
            if (parsed.success) {
              return (
                <div key={index} className="space-y-2">
                  {statusLine}
                  {parsed.data.blocks.map((block, blockIndex) => (
                    <BlockRenderer key={blockIndex} block={block} />
                  ))}
                  <SaveAsNote institutionSlug={institutionSlug} blocks={parsed.data.blocks} sourceChatId={resumedChatId} />
                </div>
              );
            }
          }

          if (part.state === "output-available" && isDraftToolPartType(part.type)) {
            const parsed = parseDraftToolOutput(part.output);
            if (parsed && "error" in parsed) {
              return (
                <div key={index} className="space-y-2">
                  {statusLine}
                  <p role="alert" className="text-sm text-destructive">
                    {parsed.error}
                  </p>
                </div>
              );
            }
            if (parsed) {
              return (
                <div key={index} className="space-y-2">
                  {statusLine}
                  <ActionDraftCard
                    institutionSlug={institutionSlug}
                    action={parsed.action}
                    input={parsed.input}
                    summary={parsed.summary}
                  />
                </div>
              );
            }
          }

          return <div key={index}>{statusLine}</div>;
        }
        return null;
      })}
    </>
  );
}

export function StudyChat({ institutionSlug, skills, notebookEnabled, initialMessages, resumedChatId, backHref, aiMode = "local" }: StudyChatProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({
      api: "/api/ai/agent/student",
      body: { institutionSlug },
    }),
  });

  const [savingChat, setSavingChat] = useState(false);
  const [chatTitle, setChatTitle] = useState("");
  const [savingChatError, setSavingChatError] = useState<string | null>(null);

  const busy = status === "submitted" || status === "streaming";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    void sendMessage({ text });
    setInput("");
  }

  function handleMakeNotes() {
    if (busy) return;
    void sendMessage({ text: "Turn our conversation so far into study notes, using the blocks tool." });
  }

  async function handleSaveChat() {
    const trimmed = chatTitle.trim();
    if (!trimmed) return;
    setSavingChatError(null);
    const result = await saveStudyChat(institutionSlug, { title: trimmed, messages });
    if (!result.ok) {
      setSavingChatError(result.error.message);
      return;
    }
    router.push(`/${institutionSlug}/portal/study/notebook/${result.data.id}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Study helper"
        compact
        back={backHref ? { href: backHref, label: "Back" } : undefined}
        actions={
          <>
            <Link href={`/${institutionSlug}/settings/study-preferences`} className={buttonVariants({ variant: "outline" })}>
              Study language
            </Link>
            {notebookEnabled && (
              <Link href={`/${institutionSlug}/portal/study/notebook`} className={buttonVariants({ variant: "outline" })}>
                My notebook
              </Link>
            )}
          </>
        }
      />
      <div className="space-y-2">
        <div role="note" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p>
          {/* Plan §8's exact wording (security review M3): "never to the
              internet" overstated it — a hosted deployment can run the
              local model through a tunnel (04-architecture.md topology B),
              so only "sent there" is actually guaranteed. */}
          {aiMode === "cloud"
            ? "AI help from Google Gemini or Groq (cloud). What you type is sent to that provider. Don't share personal details."
            : "Local AI on your school's server. What you type is sent there. Don't share personal details."}{" "}
          AI can be wrong; check your textbook or teacher.
          </p>
        </div>
        <SkillChips skills={skills} />
      </div>

      <Card className="relative">
        <BorderBeam />
        <CardContent className="flex h-[60dvh] min-h-72 flex-col gap-3 overflow-y-auto p-3 text-sm sm:h-[480px] sm:p-4" aria-live="polite">
          {messages.length === 0 && (
            <p className="text-muted-foreground">Ask about a topic you&apos;re studying — try a mindmap or a practice quiz.</p>
          )}
          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "max-w-[85%] self-end rounded-lg rounded-br-sm bg-primary px-3 py-2 text-primary-foreground" : "min-w-0 max-w-full self-start space-y-2 rounded-lg rounded-bl-sm bg-muted px-3 py-2"}>
              <MessageParts message={message} institutionSlug={institutionSlug} resumedChatId={resumedChatId} />
            </div>
          ))}
          {busy && !lastHasText(messages) && (
            <div role="status" className="self-start rounded-lg rounded-bl-sm bg-muted px-3 py-2 text-xs text-muted-foreground">
              <span className="animate-pulse">Thinking…</span>
            </div>
          )}
          {error && <ErrorState title="Message failed" description={chatErrorMessage(error)} />}
        </CardContent>
      </Card>

      {notebookEnabled && messages.length > 0 && (
        <div className="space-y-2 print:hidden">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleMakeNotes} disabled={busy}>
              Make notes
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setSavingChat((v) => !v)}>
              Save chat
            </Button>
          </div>
          {savingChat && (
            <div className="flex gap-2">
              <Input
                value={chatTitle}
                onChange={(e) => setChatTitle(e.target.value)}
                placeholder="Chat title"
                maxLength={120}
              />
              <Button type="button" size="sm" onClick={handleSaveChat} disabled={chatTitle.trim().length === 0}>
                Save
              </Button>
            </div>
          )}
          {savingChatError && <p role="alert" className="text-destructive text-xs">{savingChatError}</p>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] lg:bottom-0 -mx-1 flex gap-2 bg-background px-1 pb-2 pt-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Explain photosynthesis"
          disabled={busy}
          aria-label="Message"
         
        />
        <Button type="submit" disabled={busy || input.trim().length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}
