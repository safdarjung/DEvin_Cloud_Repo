"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ErrorCode } from "@/lib/actions/result";
import type { QuizContent } from "@/modules/academics/assignments.schemas";
import { submitAssignment } from "@/modules/academics/submissions.actions";

// One user-facing line per ErrorCode the submit RPC / defineAction can return.
const MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "Your session has expired. Sign in again to submit.",
  forbidden: "You can't submit to this assignment.",
  not_found: "This assignment is no longer available.",
  validation_failed: "Check your answer and try again.",
  conflict: "Your submission changed elsewhere. Refresh and try again.",
  invalid_state: "This assignment is closed or already graded, so it can't be changed.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  quota_exceeded: "Submission limit reached.",
  ai_unavailable: "Something went wrong. Try again.",
  ai_policy_blocked: "Something went wrong. Try again.",
  ai_invalid_output: "Something went wrong. Try again.",
  dependency_failed: "A required service is unavailable. Try again shortly.",
  internal: "Something went wrong. Try again.",
};

interface Props {
  institutionSlug: string;
  assignmentId: string;
  /** Stem + options only; answers are never sent to students. */
  questions: QuizContent["questions"] | null;
  initialText: string;
  initialAnswers: string[];
  resubmit: boolean;
}

export function AssignmentSubmitForm({ institutionSlug, assignmentId, questions, initialText, initialAnswers, resubmit }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(initialText);
  const [answers, setAnswers] = useState<string[]>(() => (questions ?? []).map((_, i) => initialAnswers[i] ?? ""));
  const [fieldError, setFieldError] = useState<string | null>(null);

  const quizComplete = !questions || answers.every(Boolean);
  const hasText = text.trim().length > 0;
  const canSubmit = (questions ? quizComplete : hasText) && !pending;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setFieldError(null);
    startTransition(async () => {
      const result = await submitAssignment(institutionSlug, {
        assignmentId,
        ...(hasText ? { text: text.trim() } : {}),
        ...(questions ? { answers } : {}),
      });
      if (result.ok) {
        toast.success(result.data.isLate ? "Submitted (marked late)" : "Submitted");
        router.refresh();
        return;
      }
      const detail = result.error.fieldErrors ? Object.values(result.error.fieldErrors).flat()[0] : undefined;
      setFieldError(detail ?? null);
      toast.error(MESSAGES[result.error.code] ?? result.error.message);
      // Closed/graded/missing: the page state is stale, reload it.
      if (["invalid_state", "not_found", "forbidden"].includes(result.error.code)) router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {questions && (
        <ol className="space-y-4">
          {questions.map((q, i) => (
            <li key={i}>
              <fieldset className="space-y-2 rounded-xl border border-border p-4">
                <legend className="px-1 text-sm font-medium">
                  {i + 1}. {q.stem}
                </legend>
                {q.options.map((option) => (
                  <label key={option} className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={`q-${i}`}
                      value={option}
                      checked={answers[i] === option}
                      onChange={() => setAnswers((a) => a.map((v, j) => (j === i ? option : v)))}
                      className="size-4 accent-primary"
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
            </li>
          ))}
        </ol>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="submission-text">{questions ? "Notes (optional)" : "Your answer"}</Label>
        <Textarea id="submission-text" value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} rows={6} />
        {fieldError && (
          <p role="alert" className="text-sm text-destructive">
            {fieldError}
          </p>
        )}
      </div>
      <Button type="submit" disabled={!canSubmit}>
        {pending ? "Submitting…" : resubmit ? "Resubmit" : "Submit"}
      </Button>
      {questions && !quizComplete && <p className="text-xs text-muted-foreground">Answer every question to submit.</p>}
    </form>
  );
}
