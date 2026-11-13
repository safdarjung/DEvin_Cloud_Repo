"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { createQuestion, updateQuestion } from "@/modules/question-bank/actions";
import type { NearDuplicate, QuestionBankItem } from "@/modules/question-bank/queries";
import type { Difficulty, QuestionType } from "@/modules/question-bank/schemas";
import { DIFFICULTIES, isStemType, pairKey, TYPES, type PairMeta } from "./question-meta";

const NONE = "none";
const BLANK = /_{3,}/g;

interface Draft {
  id?: string;
  pair: string;
  type: QuestionType;
  difficulty: Difficulty;
  body: string;
  marks: string;
  options: string[];
  correct: string[]; // mcq: one option; multi_select: several
  tf: "true" | "false";
  answer: string; // text types, and the A-D letter for assertion/reason
  blanks: string[];
  left: string[];
  right: string[];
  num: { value: string; tolerance: string; unit: string };
  assertion: string;
  reason: string;
  explanation: string;
  markingScheme: string;
  learningOutcome: string;
  unitId: string;
  topicId: string;
  bookId: string;
  chapter: string;
  page: string;
  stemId: string;
}

const blankDraft = (pair: string): Draft => ({
  pair, type: "mcq", difficulty: "medium", body: "", marks: "1", options: ["", "", "", ""], correct: [], tf: "true", answer: "",
  blanks: [""], left: ["", ""], right: ["", ""], num: { value: "", tolerance: "0", unit: "" }, assertion: "", reason: "",
  explanation: "", markingScheme: "", learningOutcome: "", unitId: "", topicId: "", bookId: "", chapter: "", page: "", stemId: "",
});

function fromItem(q: QuestionBankItem): Draft {
  const d = blankDraft(pairKey(q.gradeId, q.subjectId));
  const key = q.answerKey;
  const opts = q.options;
  const num = key as { value?: number; tolerance?: number; unit?: string } | null;
  return {
    ...d,
    id: q.id,
    type: q.type,
    difficulty: q.difficulty,
    body: q.body,
    marks: String(q.marks),
    options: Array.isArray(opts) ? opts : d.options,
    correct: q.type === "mcq" ? [q.answer] : q.type === "multi_select" && Array.isArray(key) ? (key as string[]) : [],
    tf: q.answer.toLowerCase() === "false" ? "false" : "true",
    answer: q.type === "assertion_reason" || ["short_answer", "long_answer", "very_short_answer", "diagram", "passage", "case_based"].includes(q.type) ? q.answer : "",
    blanks: q.type === "fill_blank" && Array.isArray(key) ? (key as string[]) : d.blanks,
    left: q.type === "match" && opts && !Array.isArray(opts) && "left" in opts ? opts.left : d.left,
    right: q.type === "match" && opts && !Array.isArray(opts) && "right" in opts ? opts.right : d.right,
    num: q.type === "numerical" && num ? { value: String(num.value ?? ""), tolerance: String(num.tolerance ?? 0), unit: num.unit ?? "" } : d.num,
    assertion: opts && !Array.isArray(opts) && "assertion" in opts ? opts.assertion : "",
    reason: opts && !Array.isArray(opts) && "reason" in opts ? opts.reason : "",
    explanation: q.explanation ?? "",
    markingScheme: q.markingScheme ?? "",
    learningOutcome: q.learningOutcome ?? "",
    unitId: q.curriculumUnitId ?? "",
    topicId: q.curriculumTopicId ?? "",
    bookId: q.sourceSubjectTextbookId ?? "",
    chapter: q.sourceChapterNo ? String(q.sourceChapterNo) : "",
    page: q.sourcePage ? String(q.sourcePage) : "",
    stemId: q.stemQuestionId ?? "",
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);
const intOrNull = (s: string) => (s.trim() ? Number(s) : null);

function buildInput(d: Draft): Record<string, unknown> {
  const [gradeId, subjectId] = d.pair.split(":");
  const base = {
    subjectId, gradeId, type: d.type, difficulty: d.difficulty, body: d.body, marks: Number(d.marks),
    curriculumUnitId: d.unitId || null, curriculumTopicId: d.topicId || null,
    explanation: orNull(d.explanation), markingScheme: orNull(d.markingScheme), learningOutcome: orNull(d.learningOutcome),
    sourceSubjectTextbookId: d.bookId || null, sourceChapterNo: intOrNull(d.chapter), sourcePage: intOrNull(d.page),
    stemQuestionId: isStemType(d.type) ? null : d.stemId || null,
  };
  const options = d.options.map((o) => o.trim()).filter(Boolean);
  switch (d.type) {
    case "mcq": return { ...base, options, answer: d.correct[0] ?? "" };
    case "multi_select": return { ...base, options, answerKey: d.correct };
    case "true_false": return { ...base, answer: d.tf };
    case "fill_blank": return { ...base, answerKey: d.blanks.map((b) => b.trim()).filter(Boolean) };
    case "match": {
      const rows = d.left.map((l, i) => ({ l: l.trim(), r: d.right[i]?.trim() ?? "" })).filter((r) => r.l || r.r);
      return { ...base, options: { left: rows.map((r) => r.l), right: rows.map((r) => r.r) }, answerKey: rows.map((_, i) => i) };
    }
    case "numerical":
      return { ...base, answerKey: { value: Number(d.num.value), tolerance: Number(d.num.tolerance || 0), ...(d.num.unit.trim() ? { unit: d.num.unit.trim() } : {}) } };
    case "assertion_reason": return { ...base, options: { assertion: d.assertion, reason: d.reason }, answer: d.answer || "A" };
    case "passage":
    case "case_based": return { ...base, ...(d.answer.trim() ? { answer: d.answer } : {}) };
    default: return { ...base, answer: d.answer };
  }
}

function errorText(error: Parameters<typeof actionErrorMessage>[0]): string {
  const fields = error.fieldErrors ? Object.entries(error.fieldErrors).map(([k, v]) => `${k}: ${v.join(", ")}`) : [];
  return fields.length ? `${actionErrorMessage(error)} ${fields.join(" · ")}` : actionErrorMessage(error);
}

const AR_OPTIONS = [
  ["A", "Both true, and the reason explains the assertion"],
  ["B", "Both true, but the reason does not explain the assertion"],
  ["C", "Assertion true, reason false"],
  ["D", "Assertion false, reason true"],
] as const;

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 text-sm ${className ?? ""}`}>
      {label}
      {children}
    </label>
  );
}

function ListInputs({ label, values, onChange, max, placeholder }: { label: string; values: string[]; onChange: (v: string[]) => void; max: number; placeholder: string }) {
  return (
    <div className="space-y-2">
      <p className="text-sm">{label}</p>
      {values.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label={`${placeholder} ${i + 1}`} placeholder={`${placeholder} ${i + 1}`} maxLength={500} value={v} onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))} />
          {values.length > 2 && (
            <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${placeholder} ${i + 1}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>Remove</Button>
          )}
        </div>
      ))}
      {values.length < max && <Button type="button" variant="outline" size="sm" onClick={() => onChange([...values, ""])}>Add</Button>}
    </div>
  );
}

export function QuestionForm({
  institutionSlug,
  pairs,
  stems,
  editing,
  open,
  onClose,
  onSaved,
}: {
  institutionSlug: string;
  pairs: PairMeta[];
  stems: QuestionBankItem[];
  /** undefined: new question; item: edit. */
  editing: QuestionBankItem | null | undefined;
  open: boolean;
  onClose: () => void;
  onSaved: (warnings: NearDuplicate[]) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [seen, setSeen] = useState<typeof editing | "closed">("closed");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Re-seed the form each time the dialog opens for a different question.
  if (open && seen !== editing) {
    setSeen(editing);
    setError(null);
    setDraft(editing ? fromItem(editing) : blankDraft(pairKey(pairs[0].gradeId, pairs[0].subjectId)));
  }
  if (!open && seen !== "closed") setSeen("closed");

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const pair = draft ? (pairs.find((p) => pairKey(p.gradeId, p.subjectId) === draft.pair) ?? pairs[0]) : pairs[0];
  const topics = draft ? pair.topics.filter((t) => !draft.unitId || t.unitId === draft.unitId) : [];
  const blankCount = draft ? (draft.body.match(BLANK)?.length ?? 0) : 0;
  const stemChoices = draft ? stems.filter((s) => pairKey(s.gradeId, s.subjectId) === draft.pair && s.id !== draft.id) : [];

  function save() {
    if (!draft) return;
    const input = buildInput(draft);
    setError(null);
    start(async () => {
      const result = draft.id ? await updateQuestion(institutionSlug, { id: draft.id, ...input } as never) : await createQuestion(institutionSlug, input as never);
      if (!result.ok) {
        const message = errorText(result.error);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(draft.id ? "Question updated" : "Question added");
      onSaved(result.data.warnings);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{draft?.id ? "Edit question" : "New question"}</DialogTitle>
          <DialogDescription>Only questions for grades and subjects you teach can be saved.</DialogDescription>
        </DialogHeader>
        {draft && (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <Field label="Class and subject">
              <Select value={draft.pair} onValueChange={(v) => set({ pair: v, unitId: "", topicId: "", bookId: "", stemId: "" })} disabled={Boolean(draft.id)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {pairs.map((p) => (
                    <SelectItem key={pairKey(p.gradeId, p.subjectId)} value={pairKey(p.gradeId, p.subjectId)}>{p.gradeCode} · {p.subjectName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Type">
                <Select value={draft.type} onValueChange={(v) => set({ type: v as QuestionType, correct: [], answer: "" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Difficulty">
                <Select value={draft.difficulty} onValueChange={(v) => set({ difficulty: v as Difficulty })}>
                  <SelectTrigger className="w-full capitalize"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIFFICULTIES.map((x) => <SelectItem key={x} value={x} className="capitalize">{x}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Marks">
                <Input type="number" min={0.01} max={100} step="0.5" required value={draft.marks} onChange={(e) => set({ marks: e.target.value })} className="tabular-nums" />
              </Field>
            </div>
            <Field label={isStemType(draft.type) ? (draft.type === "passage" ? "Passage text" : "Case text") : draft.type === "assertion_reason" ? "Question (instruction)" : "Question"}>
              <Textarea required rows={draft.type === "passage" || draft.type === "case_based" ? 6 : 3} maxLength={4000} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
            </Field>

            {(draft.type === "mcq" || draft.type === "multi_select") && (
              <fieldset className="space-y-2">
                <legend className="text-sm">{draft.type === "mcq" ? "Options (pick the correct one)" : "Options (tick every correct one)"}</legend>
                {draft.options.map((opt, i) => {
                  const isCorrect = opt.trim() !== "" && draft.correct.includes(opt);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type={draft.type === "mcq" ? "radio" : "checkbox"}
                        name="correct"
                        aria-label={`Option ${i + 1} is correct`}
                        checked={isCorrect}
                        disabled={opt.trim() === ""}
                        onChange={() => set({ correct: draft.type === "mcq" ? [opt] : isCorrect ? draft.correct.filter((c) => c !== opt) : [...draft.correct, opt] })}
                      />
                      <Input
                        aria-label={`Option ${i + 1}`}
                        value={opt}
                        maxLength={500}
                        placeholder={`Option ${i + 1}`}
                        onChange={(e) => set({ options: draft.options.map((o, j) => (j === i ? e.target.value : o)), correct: draft.correct.map((c) => (c === opt ? e.target.value : c)) })}
                      />
                    </div>
                  );
                })}
                {draft.options.length < (draft.type === "mcq" ? 6 : 8) && (
                  <Button type="button" variant="outline" size="sm" onClick={() => set({ options: [...draft.options, ""] })}>Add option</Button>
                )}
              </fieldset>
            )}
            {draft.type === "true_false" && (
              <Field label="Correct answer">
                <Select value={draft.tf} onValueChange={(v) => set({ tf: v as "true" | "false" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="true">True</SelectItem><SelectItem value="false">False</SelectItem></SelectContent>
                </Select>
              </Field>
            )}
            {draft.type === "fill_blank" && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Mark each blank in the question with ___ (three underscores). Give one answer per blank.</p>
                <ListInputs label={`Answers (${blankCount} blank${blankCount === 1 ? "" : "s"} in the question)`} values={draft.blanks} onChange={(blanks) => set({ blanks })} max={10} placeholder="Blank" />
              </div>
            )}
            {draft.type === "match" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <ListInputs label="Left column" values={draft.left} onChange={(left) => set({ left, right: left.length > draft.right.length ? [...draft.right, ""] : draft.right.slice(0, left.length) })} max={10} placeholder="Left" />
                <ListInputs label="Matching item on the right (same row)" values={draft.right} onChange={(right) => set({ right, left: right.length > draft.left.length ? [...draft.left, ""] : draft.left.slice(0, right.length) })} max={10} placeholder="Right" />
              </div>
            )}
            {draft.type === "numerical" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Correct value"><Input type="number" step="any" required value={draft.num.value} onChange={(e) => set({ num: { ...draft.num, value: e.target.value } })} /></Field>
                <Field label="Tolerance (±)"><Input type="number" step="any" min={0} value={draft.num.tolerance} onChange={(e) => set({ num: { ...draft.num, tolerance: e.target.value } })} /></Field>
                <Field label="Unit (optional)"><Input maxLength={20} value={draft.num.unit} onChange={(e) => set({ num: { ...draft.num, unit: e.target.value } })} /></Field>
              </div>
            )}
            {draft.type === "assertion_reason" && (
              <div className="space-y-3">
                <Field label="Assertion (A)"><Textarea required rows={2} maxLength={1000} value={draft.assertion} onChange={(e) => set({ assertion: e.target.value })} /></Field>
                <Field label="Reason (R)"><Textarea required rows={2} maxLength={1000} value={draft.reason} onChange={(e) => set({ reason: e.target.value })} /></Field>
                <Field label="Correct choice">
                  <Select value={draft.answer || "A"} onValueChange={(v) => set({ answer: v })}>
                    <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{AR_OPTIONS.map(([k, label]) => <SelectItem key={k} value={k}>{k}. {label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            {["short_answer", "long_answer", "very_short_answer", "diagram"].includes(draft.type) && (
              <Field label="Model answer"><Textarea required rows={3} maxLength={4000} value={draft.answer} onChange={(e) => set({ answer: e.target.value })} /></Field>
            )}
            {isStemType(draft.type) && (
              <p className="text-xs text-muted-foreground">Add the sub-questions as separate questions and choose this {draft.type === "passage" ? "passage" : "case"} under &quot;Belongs to&quot;.</p>
            )}
            {!isStemType(draft.type) && stemChoices.length > 0 && (
              <Field label="Belongs to a passage or case (optional)">
                <Select value={draft.stemId || NONE} onValueChange={(v) => set({ stemId: v === NONE ? "" : v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    {stemChoices.map((s) => <SelectItem key={s.id} value={s.id}>{s.body.slice(0, 70)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field label="Explanation shown with the answer (optional)"><Textarea rows={2} maxLength={4000} value={draft.explanation} onChange={(e) => set({ explanation: e.target.value })} /></Field>
            <Field label="Marking scheme (optional)"><Textarea rows={2} maxLength={4000} value={draft.markingScheme} onChange={(e) => set({ markingScheme: e.target.value })} /></Field>
            <Field label="Learning outcome (optional)"><Input maxLength={300} value={draft.learningOutcome} onChange={(e) => set({ learningOutcome: e.target.value })} /></Field>

            {(pair.units.length > 0 || pair.books.length > 0) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {pair.units.length > 0 && (
                  <Field label="Unit (optional)">
                    <Select value={draft.unitId || NONE} onValueChange={(v) => set({ unitId: v === NONE ? "" : v, topicId: "" })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>None</SelectItem>{pair.units.map((u) => <SelectItem key={u.id} value={u.id}>{u.title}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                )}
                {topics.length > 0 && (
                  <Field label="Topic (optional)">
                    <Select value={draft.topicId || NONE} onValueChange={(v) => { const t = pair.topics.find((x) => x.id === v); set({ topicId: v === NONE ? "" : v, unitId: t?.unitId ?? draft.unitId }); }}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>None</SelectItem>{topics.map((t) => <SelectItem key={t.id} value={t.id}>{t.parentId ? "  ↳ " : ""}{t.title}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                )}
                {pair.books.length > 0 && (
                  <Field label="Source textbook (optional)" className="sm:col-span-2">
                    <Select value={draft.bookId || NONE} onValueChange={(v) => set({ bookId: v === NONE ? "" : v })}>
                      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value={NONE}>None</SelectItem>{pair.books.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}</SelectContent>
                    </Select>
                  </Field>
                )}
              </div>
            )}
            {draft.bookId && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Chapter number"><Input type="number" min={1} max={99} value={draft.chapter} onChange={(e) => set({ chapter: e.target.value })} /></Field>
                <Field label="Page"><Input type="number" min={1} max={2000} value={draft.page} onChange={(e) => set({ page: e.target.value })} /></Field>
              </div>
            )}

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save question"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
