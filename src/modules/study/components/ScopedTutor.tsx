"use client";

// The scoped tutor (0140 item 8): the existing study chat kernel
// (/api/ai/agent/student) with this session's scope id, so the server adds
// the scope context and its small tool group. Quick actions either ask the
// tutor (explain, step by step, hints-first problem, what next) or make a
// study item through the studio route (quiz, flashcards, summary) that is
// kept in the Library with the normal save action. Messages are saved to the
// session after each answer, so it can be resumed.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { chatErrorMessage } from "@/modules/ai/chat-error";
import { lastHasText, plainChatText } from "@/modules/ai/chat-text";
import { updateStudyItem } from "@/modules/ai/student-study.actions";
import { saveStudyMaterial } from "@/modules/study/actions";
import { FORMAT_LABELS } from "@/modules/study/formats";
import { logStudyScopeTime, saveStudyScopeMessages } from "@/modules/study/scope.actions";
import { AiLabel, MaterialView } from "./MaterialView";

const ASK: { label: string; text: string }[] = [
  { label: "Explain this", text: "Explain the main ideas of what I picked, simply, one at a time." },
  { label: "Teach me step by step", text: "Teach me this step by step. Check I understood each step before the next." },
  { label: "Solve a problem with hints", text: "Give me one exam-style problem from this and help me solve it with hints first, not the answer." },
  { label: "What should I study next here?", text: "What should I study next in this scope, and why? Use my practice so far." },
];
type MakeFormat = "quiz" | "flashcards" | "quick_summary";
const MAKE: { label: string; format: MakeFormat }[] = [
  { label: "Quiz me on it", format: "quiz" },
  { label: "Make flashcards", format: "flashcards" },
  { label: "Summarise", format: "quick_summary" },
];

interface Draft {
  format: MakeFormat;
  title: string;
  subjectId: string | null;
  unitId: string | null;
  focusUnitIds: string[];
  content: unknown;
}

export function ScopedTutor({
  institutionSlug,
  itemId,
  title: initialTitle,
  scopeLines,
  initialMessages,
  aiMode,
}: {
  institutionSlug: string;
  itemId: string;
  title: string;
  scopeLines: string[];
  initialMessages: UIMessage[];
  aiMode: "cloud" | "local";
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [title, setTitle] = useState(initialTitle);
  const [making, setMaking] = useState<MakeFormat | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, startSave] = useTransition();
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const { messages, sendMessage, status, error } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: "/api/ai/agent/student", body: { institutionSlug, scopeId: itemId } }),
  });
  const busy = status === "submitted" || status === "streaming";

  // Save the session after each finished answer (resume later).
  const savedCount = useRef(initialMessages.length);
  useEffect(() => {
    if (status !== "ready" || messages.length === savedCount.current) return;
    savedCount.current = messages.length;
    void saveStudyScopeMessages(institutionSlug, { itemId, messages: messages.slice(-50) });
  }, [status, messages, institutionSlug, itemId]);

  async function make(format: MakeFormat) {
    setMaking(format);
    try {
      const res = await fetch("/api/ai/study-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          institutionSlug,
          format,
          source: { kind: "scope", itemId },
          ...(format === "quiz" ? { quiz: { count: 5, difficulty: "medium", types: ["mcq", "true_false", "short"] } } : {}),
        }),
      });
      const body = (await res.json()) as { ok: true; data: Draft } | { ok: false; error: { message: string } };
      if (!body.ok) toast.error(`${body.error.message} Nothing was saved.`);
      else setDraft(body.data);
    } catch {
      toast.error("Could not reach the server. Check your connection and try again.");
    } finally {
      setMaking(null);
    }
  }

  function keep() {
    if (!draft) return;
    startSave(async () => {
      const res = await saveStudyMaterial(institutionSlug, {
        format: draft.format,
        title: draft.title,
        sourceKind: "scope",
        content: draft.content,
        focusUnitIds: draft.focusUnitIds,
        ...(draft.subjectId ? { subjectId: draft.subjectId } : {}),
        ...(draft.unitId ? { unitId: draft.unitId } : {}),
      });
      if (!res.ok) {
        toast.error(describeActionError(res.error));
        return;
      }
      const base = `/${institutionSlug}/portal/study/studio`;
      const href = draft.format === "flashcards" ? `${base}?tab=cards&deck=${res.data.id}` : draft.format === "quiz" ? `${base}?tab=quiz&quiz=${res.data.id}` : `${base}?tab=library&item=${res.data.id}`;
      toast.success(`${FORMAT_LABELS[draft.format]} saved to your library.`, { action: { label: "Open", onClick: () => router.push(href) } });
      setDraft(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Session name</span>
          <input
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={async () => {
              if (!title.trim() || title === initialTitle) return;
              const res = await updateStudyItem(institutionSlug, { itemId, title: title.trim() });
              if (!res.ok) toast.error(describeActionError(res.error));
            }}
            className="w-full rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold outline-none hover:border-input focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            const minutes = Math.min(180, Math.max(1, Math.round((Date.now() - startedAt) / 60_000)));
            const res = await logStudyScopeTime(institutionSlug, { itemId, minutes });
            if (!res.ok) toast.error(describeActionError(res.error));
            else toast.success(`Logged ${res.data.minutes} minutes of study.`);
            setStartedAt(Date.now());
          }}
        >
          Finish session
        </Button>
      </div>

      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="min-h-10 cursor-pointer py-1 font-medium">What this session covers</summary>
        <ul className="mt-1 space-y-0.5 text-muted-foreground">
          {scopeLines.slice(1).map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
      <p role="note" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
        {aiMode === "cloud" ? "AI tutor on the school's cloud AI (Groq or Google Gemini)." : "AI tutor on the school's own server."} It has not read NCERT books: it works from your
        chapters&apos; and units&apos; outlines, unless you paste text or it reads a file you picked. AI can be wrong. Practice only.
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Quick actions">
        {ASK.map((a) => (
          <Button key={a.label} size="sm" variant="outline" disabled={busy} onClick={() => void sendMessage({ text: a.text })}>
            {a.label}
          </Button>
        ))}
        {MAKE.map((m) => (
          <Button key={m.format} size="sm" variant="secondary" disabled={making !== null} onClick={() => make(m.format)}>
            {making === m.format ? "Making…" : m.label}
          </Button>
        ))}
      </div>

      {draft && (
        <section aria-label="Study item draft" className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">{draft.title}</p>
            <AiLabel />
          </div>
          {draft.format === "quiz" ? <p className="text-sm text-muted-foreground">Save it, then take it in Quizzes. Your score counts towards this scope&apos;s progress.</p> : <MaterialView format={draft.format} content={draft.content} />}
          <div className="flex gap-2">
            <Button size="sm" onClick={keep} disabled={saving}>
              {saving ? "Saving…" : "Save to library"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
              Discard
            </Button>
          </div>
        </section>
      )}

      <div className="flex h-[55dvh] min-h-72 flex-col gap-3 overflow-y-auto rounded-xl border p-3 text-sm" aria-live="polite">
        {messages.length === 0 && <p className="text-muted-foreground">Pick a quick action or ask anything about what you chose.</p>}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "max-w-[85%] self-end rounded-lg bg-primary px-3 py-2 text-primary-foreground" : "max-w-full self-start space-y-1 rounded-lg bg-muted px-3 py-2"}>
            {m.parts.map((p, i) =>
              p.type === "text" ? (
                <p key={i} className="whitespace-pre-wrap">
                  {plainChatText(p.text)}
                </p>
              ) : isToolUIPart(p) ? (
                <Badge key={i} variant="outline" className="text-xs">
                  {p.type === "tool-readScopeFile" ? (p.state === "output-available" ? "Read your file" : "Reading your file…") : "Looking it up…"}
                </Badge>
              ) : null,
            )}
          </div>
        ))}
        {busy && !lastHasText(messages) && <p className="self-start text-xs text-muted-foreground">Thinking…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{chatErrorMessage(error)}</p>}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          void sendMessage({ text: input.trim() });
          setInput("");
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">Message</span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 2000))}
            placeholder="Ask about your chapters…"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <Button type="submit" disabled={busy || !input.trim()}>
          Send
        </Button>
      </form>
      <Link href={`/${institutionSlug}/portal/study/scope`} className="inline-flex min-h-10 items-center text-sm underline underline-offset-4">
        All study sessions
      </Link>
    </div>
  );
}
