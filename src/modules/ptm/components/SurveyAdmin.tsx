"use client";

// Survey admin controls. Hiding them is UX only: the actions re-check
// `survey.manage` and the Zod schema server-side. A created survey opens
// immediately (createSurvey sets status "open"), so there is no draft step.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { closeSurvey, createSurvey } from "@/modules/ptm/survey.actions";
import { SURVEY_MAX_QUESTIONS, SurveyCreateSchema } from "@/modules/ptm/schemas";

const SELECT_CLASS = "h-10 rounded-[15px] border border-input bg-transparent px-3 text-sm";

type QType = "single" | "multi" | "text";
interface DraftQuestion {
  type: QType;
  prompt: string;
  /** One option per line. */
  options: string;
}

const AUDIENCES = [
  { value: "school", label: "Whole school" },
  { value: "guardian", label: "Guardians" },
  { value: "teacher", label: "Teachers" },
] as const;

export function SurveyForm({ institutionSlug }: { institutionSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState({ title: "", description: "", isAnonymous: true, closesAt: "", audience: "guardian" as (typeof AUDIENCES)[number]["value"] });
  const [questions, setQuestions] = useState<DraftQuestion[]>([{ type: "single", prompt: "", options: "" }]);

  function setQ(i: number, patch: Partial<DraftQuestion>) {
    setQuestions((qs) => qs.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = {
      title: form.title,
      description: form.description || undefined,
      isAnonymous: form.isAnonymous,
      closesAt: form.closesAt ? `${form.closesAt}:00+05:30` : "",
      questions: questions.map((q) =>
        q.type === "text"
          ? { type: "text" as const, prompt: q.prompt }
          : { type: q.type, prompt: q.prompt, options: q.options.split("\n").map((o) => o.trim()).filter(Boolean) },
      ),
      audiences: [form.audience === "school" ? { type: "school" as const } : { type: "role" as const, role: form.audience }],
    };
    const parsed = SurveyCreateSchema.safeParse(input);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join(".") || "form"}: ${i.message}`));
      return;
    }
    setErrors([]);
    start(async () => {
      const res = await createSurvey(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Survey published");
        setForm({ ...form, title: "", description: "" });
        setQuestions([{ type: "single", prompt: "", options: "" }]);
        router.refresh();
      } else {
        if (res.error.fieldErrors) setErrors(Object.entries(res.error.fieldErrors).map(([k, v]) => `${k}: ${v.join(" ")}`));
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-busy={pending}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="sv-title">Title</Label>
          <Input id="sv-title" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="sv-desc">Description (optional)</Label>
          <Input id="sv-desc" value={form.description} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="sv-closes">Closes (IST, within 90 days)</Label>
          <Input id="sv-closes" type="datetime-local" value={form.closesAt} onChange={(e) => setForm({ ...form, closesAt: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="sv-aud">Audience</Label>
          <select id="sv-aud" className={`${SELECT_CLASS} w-full`} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as typeof form.audience })}>
            {AUDIENCES.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.isAnonymous} onChange={(e) => setForm({ ...form, isAnonymous: e.target.checked })} />
          Anonymous responses (results show only once enough people respond)
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Questions</legend>
        {questions.map((q, i) => (
          <div key={i} className="space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap gap-2">
              <select aria-label={`Question ${i + 1} type`} className={SELECT_CLASS} value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QType })}>
                <option value="single">Single choice</option>
                <option value="multi">Multiple choice</option>
                <option value="text">Free text</option>
              </select>
              <Input aria-label={`Question ${i + 1} prompt`} className="min-w-48 flex-1" placeholder="Question" maxLength={200} value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />
              {questions.length > 1 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setQuestions((qs) => qs.filter((_, idx) => idx !== i))}>
                  Remove
                </Button>
              )}
            </div>
            {q.type !== "text" && (
              <textarea
                aria-label={`Question ${i + 1} options, one per line`}
                className="min-h-20 w-full rounded-[15px] border border-input bg-transparent px-3 py-2 text-sm"
                placeholder={"Options, one per line (2 to 6)"}
                value={q.options}
                onChange={(e) => setQ(i, { options: e.target.value })}
              />
            )}
          </div>
        ))}
        {questions.length < SURVEY_MAX_QUESTIONS && (
          <Button type="button" variant="outline" size="sm" onClick={() => setQuestions((qs) => [...qs, { type: "single", prompt: "", options: "" }])}>
            Add question
          </Button>
        )}
      </fieldset>

      {errors.length > 0 && (
        <ul role="alert" className="space-y-0.5 text-xs text-destructive">
          {errors.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Publishing…" : "Publish survey"}
      </Button>
    </form>
  );
}

export function CloseSurveyButton({ institutionSlug, surveyId, title }: { institutionSlug: string; surveyId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Close
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close this survey?</DialogTitle>
            <DialogDescription>&ldquo;{title}&rdquo; stops accepting responses. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
              Keep open
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await closeSurvey(institutionSlug, { surveyId });
                  if (res.ok) {
                    toast.success("Survey closed");
                    setOpen(false);
                    router.refresh();
                  } else {
                    toast.error(describeActionError(res.error));
                  }
                })
              }
            >
              {pending ? "Closing…" : "Close survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
