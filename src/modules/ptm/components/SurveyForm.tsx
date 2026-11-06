"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { respondToSurvey } from "@/modules/ptm/survey.actions";

export type SurveyQuestion =
  | { type: "single"; prompt: string; options: string[] }
  | { type: "multi"; prompt: string; options: string[] }
  | { type: "text"; prompt: string };

type Answer = number | number[] | string;

/** One survey response. Answers are option indexes (single/multi) or free text, one per question, in order. */
export function SurveyForm({ institutionSlug, surveyId, questions }: { institutionSlug: string; surveyId: string; questions: SurveyQuestion[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<(Answer | undefined)[]>(() => questions.map(() => undefined));

  const set = (i: number, value: Answer | undefined) => setAnswers((prev) => prev.map((a, j) => (j === i ? value : a)));
  const complete = answers.every((a) => a !== undefined && (typeof a !== "string" || a.trim() !== ""));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    start(async () => {
      const result = await respondToSurvey(institutionSlug, { surveyId, answers: answers as Answer[] });
      if (result.ok) {
        toast.success("Response submitted. Thank you.");
        router.refresh();
      } else {
        toast.error(result.error.message);
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      {questions.map((q, i) => (
        <fieldset key={i} className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{q.prompt}</legend>
          {q.type === "text" ? (
            <Textarea rows={3} maxLength={500} aria-label={q.prompt} value={(answers[i] as string | undefined) ?? ""} onChange={(e) => set(i, e.target.value)} />
          ) : (
            q.options.map((opt, o) => {
              const checked = q.type === "single" ? answers[i] === o : ((answers[i] as number[] | undefined) ?? []).includes(o);
              return (
                <label key={o} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm">
                  <input
                    type={q.type === "single" ? "radio" : "checkbox"}
                    name={`q${i}`}
                    checked={checked}
                    onChange={() => {
                      if (q.type === "single") return set(i, o);
                      const cur = (answers[i] as number[] | undefined) ?? [];
                      const next = cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o].sort((a, b) => a - b);
                      set(i, next.length ? next : undefined);
                    }}
                    className="size-4"
                  />
                  {opt}
                </label>
              );
            })
          )}
        </fieldset>
      ))}
      <Button type="submit" className="min-h-10 w-full sm:w-fit" disabled={pending || !complete}>
        {pending ? "Submitting…" : "Submit response"}
      </Button>
    </form>
  );
}
