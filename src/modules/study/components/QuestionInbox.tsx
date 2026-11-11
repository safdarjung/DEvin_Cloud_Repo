"use client";

// Teacher inbox for "Ask my teacher" (0140): questions from students they
// teach in that subject (RLS), unanswered first. Answering notifies the
// student (in-app, DB trigger).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { describeActionError } from "@/lib/action-error";
import { answerStudyQuestion } from "@/modules/study/help.actions";
import type { StudyQuestionRow } from "@/modules/study/help.queries";

const dateFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
const CONTEXT: Record<string, string> = { material: "about a study material", quiz_question: "about a quiz question", flashcard: "about a flashcard", general: "" };

function AnswerForm({ institutionSlug, row }: { institutionSlug: string; row: StudyQuestionRow }) {
  const router = useRouter();
  const [text, setText] = useState(row.answer ?? "");
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-2 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await answerStudyQuestion(institutionSlug, { questionId: row.id, answer: text });
          if (!res.ok) {
            toast.error(describeActionError(res.error));
            return;
          }
          toast.success("Answer sent. The student is notified.");
          router.refresh();
        });
      }}
    >
      <label className="block text-sm">
        <span className="sr-only">Answer</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          rows={2}
          placeholder="Your answer"
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending || !text.trim()}>
        {pending ? "Sending…" : row.answer ? "Update answer" : "Send answer"}
      </Button>
    </form>
  );
}

export function QuestionInbox({ institutionSlug, rows }: { institutionSlug: string; rows: StudyQuestionRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No questions from your students yet.</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border bg-card p-4">
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {r.answer ? <Badge variant="outline">Answered</Badge> : <Badge>New</Badge>}
            <span>
              {r.studentName} · {r.sectionLabel} · {r.subjectName} {CONTEXT[r.contextKind]} · {dateFmt.format(new Date(r.createdAt))}
            </span>
          </p>
          {r.contextExcerpt && <p className="mt-2 rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">“{r.contextExcerpt}”</p>}
          <p className="mt-2 text-sm font-medium">{r.question}</p>
          <AnswerForm institutionSlug={institutionSlug} row={r} />
        </li>
      ))}
    </ul>
  );
}
