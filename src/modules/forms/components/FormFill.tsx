"use client";

// One response to one form (per child for a guardian). Labels, options and answers are user content:
// rendered as React text only, never as HTML. Mirrors submit_form_response via validateFormAnswers.
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { respondToForm } from "@/modules/forms/actions";
import { FORM_TEXT_ANSWER_MAX, validateFormAnswers, type FormAnswer, type FormField } from "@/modules/forms/schemas";

export function FormFill({
  institutionSlug,
  formId,
  studentId,
  fields,
}: {
  institutionSlug: string;
  formId: string;
  studentId: string | null;
  fields: FormField[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answers, setAnswers] = useState<FormAnswer[]>(() => fields.map((f) => (f.type === "consent" ? false : null)));
  const [errors, setErrors] = useState<Record<number, string>>({});
  const set = (i: number, v: FormAnswer) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)));

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const found = validateFormAnswers(fields, answers);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    start(async () => {
      const res = await respondToForm(institutionSlug, { formId, studentId, answers });
      if (res.ok) {
        toast.success("Response submitted. Thank you.");
        router.refresh();
      } else {
        toast.error(res.error.message);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5" aria-busy={pending}>
      {fields.map((f, i) => (
        <fieldset key={i} className="grid gap-2">
          {f.type === "consent" ? (
            <label className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md border border-border p-3 text-sm">
              <input type="checkbox" className="mt-0.5" checked={answers[i] === true} onChange={(e) => set(i, e.target.checked)} />
              <span>
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </span>
            </label>
          ) : (
            <>
              <legend className="mb-1 text-sm font-medium">
                {f.label}
                {f.required && <span className="text-destructive"> *</span>}
              </legend>
              {f.type === "text" ? (
                <Textarea
                  rows={2}
                  maxLength={FORM_TEXT_ANSWER_MAX}
                  aria-label={f.label}
                  value={typeof answers[i] === "string" ? (answers[i] as string) : ""}
                  onChange={(e) => set(i, e.target.value === "" ? null : e.target.value)}
                />
              ) : (
                f.options.map((opt, o) => (
                  <label key={o} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm">
                    <input type="radio" name={`f${formId}-${studentId ?? "me"}-${i}`} checked={answers[i] === o} onChange={() => set(i, o)} />
                    {opt}
                  </label>
                ))
              )}
            </>
          )}
          {errors[i] && (
            <p role="alert" className="text-xs text-destructive">
              {errors[i]}
            </p>
          )}
        </fieldset>
      ))}
      <Button type="submit" disabled={pending} className="justify-self-start">
        {pending ? "Submitting…" : "Submit response"}
      </Button>
    </form>
  );
}
