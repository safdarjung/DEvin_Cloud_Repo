"use client";

// One question of a paper: edit an existing snapshot, or add a manual one.
// Complex types (match, numerical...) keep their stored options/answer key;
// only the wording, marks and difficulty change here.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DIFFICULTIES, TYPES } from "@/modules/question-bank/components/question-meta";
import type { Difficulty, QuestionType } from "@/modules/question-bank/schemas";
import type { PaperItem } from "@/modules/question-papers/queries";
import { SELECT_CLASS } from "./paper-ui";

export const MANUAL_TYPES: QuestionType[] = ["mcq", "true_false", "very_short_answer", "short_answer", "long_answer"];
const TEXT_ANSWER: QuestionType[] = ["very_short_answer", "short_answer", "long_answer", "diagram"];

export interface ItemDraft {
  type: QuestionType;
  difficulty: Difficulty;
  body: string;
  marks: string;
  options: string[];
  answer: string;
}

export const blankDraft = (): ItemDraft => ({ type: "short_answer", difficulty: "medium", body: "", marks: "2", options: ["", "", "", ""], answer: "" });

export const draftFromItem = (it: PaperItem): ItemDraft => ({
  type: it.type,
  difficulty: it.difficulty,
  body: it.body,
  marks: String(it.marks),
  options: it.type === "mcq" && Array.isArray(it.options) ? (it.options as string[]) : ["", "", "", ""],
  answer: it.answer ?? "",
});

/** Payload for addManualItem / updateItem. `existing` carries the stored shape of types this form cannot edit. */
export function toPayload(d: ItemDraft, existing?: PaperItem): Record<string, unknown> {
  const out: Record<string, unknown> = { type: d.type, difficulty: d.difficulty, body: d.body.trim(), marks: Number(d.marks) };
  if (d.type === "mcq") out.options = d.options.map((o) => o.trim()).filter(Boolean);
  else if (existing?.options != null) out.options = existing.options;
  if (existing?.answerKey != null) out.answerKey = existing.answerKey;
  if (d.answer.trim()) out.answer = d.answer.trim();
  if (existing) {
    if (existing.explanation) out.explanation = existing.explanation;
    if (existing.markingScheme) out.markingScheme = existing.markingScheme;
    if (existing.curriculumUnitId) out.curriculumUnitId = existing.curriculumUnitId;
    if (existing.curriculumTopicId) out.curriculumTopicId = existing.curriculumTopicId;
    if (existing.sourceSubjectTextbookId) out.sourceSubjectTextbookId = existing.sourceSubjectTextbookId;
    if (existing.sourceChapterNo) out.sourceChapterNo = existing.sourceChapterNo;
    if (existing.sourcePage) out.sourcePage = existing.sourcePage;
  }
  return out;
}

export function ItemForm({
  initial,
  lockType,
  submitLabel,
  busy,
  onSubmit,
  onCancel,
}: {
  initial: ItemDraft;
  lockType: boolean;
  submitLabel: string;
  busy: boolean;
  onSubmit: (d: ItemDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState(initial);
  const set = (patch: Partial<ItemDraft>) => setD((x) => ({ ...x, ...patch }));
  const opts = d.options.map((o) => o.trim()).filter(Boolean);
  const answerOk =
    d.type === "mcq" ? opts.includes(d.answer) : d.type === "true_false" ? d.answer === "true" || d.answer === "false" : !TEXT_ANSWER.includes(d.type) || d.answer.trim() !== "";
  const valid = d.body.trim() !== "" && Number(d.marks) > 0 && answerOk && (d.type !== "mcq" || opts.length >= 2);
  const typeChoices = lockType ? TYPES.filter((t) => t.value === d.type) : TYPES.filter((t) => MANUAL_TYPES.includes(t.value));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(d);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Type</Label>
          <select aria-label="Question type" className={SELECT_CLASS} disabled={lockType} value={d.type} onChange={(e) => set({ type: e.target.value as QuestionType, answer: "" })}>
            {typeChoices.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label>Marks</Label>
          <Input aria-label="Marks" inputMode="decimal" value={d.marks} onChange={(e) => set({ marks: e.target.value.replace(/[^\d.]/g, "") })} />
        </div>
        <div className="space-y-1">
          <Label>Difficulty</Label>
          <select aria-label="Difficulty" className={SELECT_CLASS} value={d.difficulty} onChange={(e) => set({ difficulty: e.target.value as Difficulty })}>
            {DIFFICULTIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
      </div>
      <div className="space-y-1">
        <Label>Question</Label>
        <Textarea aria-label="Question text" rows={3} value={d.body} onChange={(e) => set({ body: e.target.value })} />
      </div>
      {d.type === "mcq" && (
        <div className="space-y-2">
          <Label>Options (pick the correct one)</Label>
          {d.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" aria-label={`Option ${i + 1} is correct`} checked={o.trim() !== "" && d.answer === o.trim()} onChange={() => set({ answer: o.trim() })} disabled={o.trim() === ""} />
              <Input aria-label={`Option ${i + 1}`} value={o} onChange={(e) => set({ options: d.options.map((x, k) => (k === i ? e.target.value : x)), answer: d.answer === o.trim() ? e.target.value.trim() : d.answer })} />
            </div>
          ))}
        </div>
      )}
      {d.type === "true_false" && (
        <div className="space-y-1">
          <Label>Correct answer</Label>
          <select aria-label="Correct answer" className={SELECT_CLASS} value={d.answer} onChange={(e) => set({ answer: e.target.value })}>
            <option value="">Choose</option>
            <option value="true">True</option>
            <option value="false">False</option>
          </select>
        </div>
      )}
      {["very_short_answer", "short_answer", "long_answer", "diagram", "numerical", "match", "multi_select", "fill_blank"].includes(d.type) && (
        <div className="space-y-1">
          <Label>{TEXT_ANSWER.includes(d.type) ? "Model answer" : "Answer note (optional)"}</Label>
          <Textarea aria-label="Model answer" rows={2} value={d.answer} onChange={(e) => set({ answer: e.target.value })} />
        </div>
      )}
      {lockType && !["mcq", "true_false", "very_short_answer", "short_answer", "long_answer"].includes(d.type) && (
        <p className="text-xs text-muted-foreground">Options and answer key of this question type stay as saved.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!valid || busy}>{busy ? "Saving…" : submitLabel}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
