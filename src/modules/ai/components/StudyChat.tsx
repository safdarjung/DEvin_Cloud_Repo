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
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { BlockRenderer } from "@/modules/ai/blocks/BlockRenderer";
import { BlockSchema, type Block } from "@/modules/ai/blocks/schemas";
import type { StudentSkill } from "@/modules/ai/prompts/student-skills";
import { saveStudyChat, saveStudyNote } from "@/modules/ai/student-study.actions";

interface StudyChatProps {
  institutionSlug: string;
  skills: StudentSkill[];
  notebookEnabled: boolean;
  /** Resuming a saved chat (GU-09: "reopening seeds useChat({ messages })") — omitted for a fresh session. */
  initialMessages?: UIMessage[];
  /** The saved chat item's own id, when resuming — new notes made in this session reference it as `sourceChatId`. */
  resumedChatId?: string;
}

const TOOL_LABELS: Record<string, string> = {
  findMyCurriculumUnit: "Looking up the topic…",
  showStudyBlocks: "Preparing visuals…",
};

function toolLabel(type: string): string {
  const name = type.startsWith("tool-") ? type.slice(5) : type;
  return TOOL_LABELS[name] ?? `Using ${name}…`;
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
    <div className="flex gap-2">
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
      {error && <p className="text-destructive text-xs">{error}</p>}
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
              {part.text}
            </p>
          );
        }
        if (isToolUIPart(part)) {
          const label = toolLabel(part.type);
          const done = part.state === "output-available" || part.state === "output-error";
          const statusLine = (
            <div className="text-muted-foreground border-l-2 pl-2 text-xs italic">
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

          return <div key={index}>{statusLine}</div>;
        }
        return null;
      })}
    </>
  );
}

export function StudyChat({ institutionSlug, skills, notebookEnabled, initialMessages, resumedChatId }: StudyChatProps) {
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
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Study helper</h1>
          {notebookEnabled && (
            <Link href={`/${institutionSlug}/portal/study/notebook`} className="text-muted-foreground text-sm underline">
              My notebook
            </Link>
          )}
        </div>
        <div className="mt-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          {/* Plan §8's exact wording (security review M3): "never to the
              internet" overstated it — a hosted deployment can run the
              local model through a tunnel (04-architecture.md topology B),
              so only "sent there" is actually guaranteed. */}
          Local AI on your school&apos;s server. What you type is sent there. Don&apos;t share personal details.
          AI can be wrong; check your textbook or teacher.
        </div>
        <div className="mt-1">
          <SkillChips skills={skills} />
        </div>
      </div>

      <Card>
        <CardContent className="flex h-[480px] flex-col gap-3 overflow-y-auto p-4 text-sm">
          {messages.length === 0 && (
            <p className="text-muted-foreground">Ask about a topic you&apos;re studying — try a mindmap or a practice quiz.</p>
          )}
          {messages.map((message) => (
            <div key={message.id} className={message.role === "user" ? "self-end text-right" : "self-start"}>
              <MessageParts message={message} institutionSlug={institutionSlug} resumedChatId={resumedChatId} />
            </div>
          ))}
          {error && <p className="text-destructive text-sm">{error.message}</p>}
        </CardContent>
      </Card>

      {notebookEnabled && messages.length > 0 && (
        <div className="space-y-2 print:hidden">
          <div className="flex gap-2">
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
          {savingChatError && <p className="text-destructive text-xs">{savingChatError}</p>}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Explain photosynthesis"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || input.trim().length === 0}>
          Send
        </Button>
      </form>
    </div>
  );
}
