"use client";

// "Ask my teacher" (0140): a student sends a question, with the material /
// quiz question / flashcard they were looking at, to the teacher(s) of that
// subject in their own section. Not AI: a person answers. study.question.ask
// re-checks the student, section and subject (RLS); the teacher is notified.
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { askStudyQuestion } from "@/modules/study/help.actions";

export function AskTeacher({
  institutionSlug,
  subjectId,
  contextKind,
  materialId,
  excerpt,
  compact,
}: {
  institutionSlug: string;
  subjectId: string;
  contextKind: "material" | "quiz_question" | "flashcard" | "general";
  materialId?: string;
  excerpt?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  if (sent) return <p className="mt-2 text-xs text-muted-foreground">Sent to your teacher. Their answer shows under Progress → Your questions.</p>;
  if (!open) {
    return (
      <Button type="button" size="sm" variant={compact ? "ghost" : "outline"} className={compact ? "mt-1 h-9 px-2 text-xs" : ""} onClick={() => setOpen(true)}>
        <MessageCircleQuestion className="size-4" aria-hidden /> Ask my teacher
      </Button>
    );
  }
  return (
    <form
      className="mt-2 space-y-2 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await askStudyQuestion(institutionSlug, {
            subjectId,
            contextKind,
            question: text,
            ...(materialId ? { materialId } : {}),
            ...(excerpt ? { contextExcerpt: excerpt.slice(0, 1000) } : {}),
          });
          if (!res.ok) {
            toast.error(describeActionError(res.error));
            return;
          }
          setSent(true);
          toast.success("Question sent to your teacher.");
        });
      }}
    >
      <label className="block text-sm">
        Your question
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 1000))}
          rows={3}
          required
          minLength={3}
          className="mt-1 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      {excerpt && <p className="text-xs text-muted-foreground">Sent with: “{excerpt.slice(0, 140)}{excerpt.length > 140 ? "…" : ""}”</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || text.trim().length < 3}>
          {pending ? "Sending…" : "Send"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
