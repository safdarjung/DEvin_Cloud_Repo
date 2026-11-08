"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { BarList } from "@/components/widgets/viz";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { archiveQuestion, createQuestion, updateQuestion } from "@/modules/question-bank/actions";
import type { QuestionBankItem, TeachingPair } from "@/modules/question-bank/queries";
import type { Difficulty, QuestionType } from "@/modules/question-bank/schemas";

const TYPES: { value: QuestionType; label: string }[] = [
  { value: "mcq", label: "Multiple choice" },
  { value: "true_false", label: "True or false" },
  { value: "short_answer", label: "Short answer" },
  { value: "long_answer", label: "Long answer" },
];
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const typeLabel = (t: QuestionType) => TYPES.find((x) => x.value === t)?.label ?? t;

interface Draft {
  id?: string;
  pair: string;
  type: QuestionType;
  difficulty: Difficulty;
  body: string;
  options: string[];
  answer: string;
  marks: string;
}

const pairKey = (gradeId: string, subjectId: string) => `${gradeId}:${subjectId}`;

export function QuestionBankView({
  institutionSlug,
  items,
  total,
  pairs,
  canManage,
}: {
  institutionSlug: string;
  items: QuestionBankItem[];
  total: number;
  pairs: TeachingPair[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canAuthor = canManage && pairs.length > 0;

  function openNew() {
    setError(null);
    const first = pairs[0];
    setDraft({ pair: pairKey(first.gradeId, first.subjectId), type: "mcq", difficulty: "medium", body: "", options: ["", "", "", ""], answer: "", marks: "1" });
  }

  function openEdit(q: QuestionBankItem) {
    setError(null);
    setDraft({
      id: q.id,
      pair: pairKey(q.gradeId, q.subjectId),
      type: q.type,
      difficulty: q.difficulty,
      body: q.body,
      options: q.options ?? ["", "", "", ""],
      answer: q.answer,
      marks: String(q.marks),
    });
  }

  function save() {
    if (!draft) return;
    const [gradeId, subjectId] = draft.pair.split(":");
    const options = draft.type === "mcq" ? draft.options.map((o) => o.trim()).filter(Boolean) : undefined;
    const input = {
      subjectId,
      gradeId,
      type: draft.type,
      difficulty: draft.difficulty,
      body: draft.body,
      ...(options ? { options } : {}),
      answer: draft.type === "true_false" && !draft.answer ? "True" : draft.answer,
      marks: Number(draft.marks),
    };
    setError(null);
    start(async () => {
      const result = draft.id ? await updateQuestion(institutionSlug, { id: draft.id, ...input }) : await createQuestion(institutionSlug, input);
      if (!result.ok) {
        const message = actionErrorMessage(result.error);
        setError(message);
        toast.error(message);
        return;
      }
      toast.success(draft.id ? "Question updated" : "Question added");
      setDraft(null);
      router.refresh();
    });
  }

  function setArchived(q: QuestionBankItem, isActive: boolean) {
    start(async () => {
      const result = await archiveQuestion(institutionSlug, { id: q.id, isActive });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      toast.success(isActive ? "Question restored" : "Question archived");
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {canAuthor && (
        <div className="flex justify-end">
          <Button onClick={openNew}>New question</Button>
        </div>
      )}
      {items.length === 0 ? (
        <EmptyState
          title="No questions yet"
          description={canAuthor ? "Add questions for the grades and subjects you teach, then reuse them in assignments and exams." : "Questions for your subjects appear here."}
          action={canAuthor ? <Button onClick={openNew}>New question</Button> : undefined}
        />
      ) : (
        <>
          <div className="max-w-xl">
            <p className="mb-1 text-sm font-medium">Difficulty mix (shown questions)</p>
            <BarList
              ariaLabel="Questions shown by difficulty"
              max={items.length}
              items={DIFFICULTIES.map((d) => ({
                label: d.charAt(0).toUpperCase() + d.slice(1),
                value: items.filter((q) => q.difficulty === d).length,
              }))}
            />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Question</TableHead>
                <TableHead>Class and subject</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Difficulty</TableHead>
                <TableHead className="text-right">Marks</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((q, i) => (
                <TableRow
                  key={q.id}
                  className="motion-safe:animate-in motion-safe:fade-in motion-safe:fill-mode-backwards motion-safe:duration-200"
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <TableCell className="max-w-md">
                    <p className="line-clamp-2 whitespace-normal">{q.body}</p>
                    {!q.isActive && <Badge variant="outline">Archived</Badge>}
                  </TableCell>
                  <TableCell>
                    {q.gradeCode} · {q.subjectName}
                  </TableCell>
                  <TableCell>{typeLabel(q.type)}</TableCell>
                  <TableCell className="capitalize">{q.difficulty}</TableCell>
                  <TableCell className="text-right tabular-nums">{q.marks}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(q)} disabled={pending}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setArchived(q, !q.isActive)} disabled={pending}>
                          {q.isActive ? "Archive" : "Restore"}
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs tabular-nums text-muted-foreground">
            Showing {items.length} of {total}
          </p>
        </>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit question" : "New question"}</DialogTitle>
            <DialogDescription>Only questions for grades and subjects you teach can be saved.</DialogDescription>
          </DialogHeader>
          {draft && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <label className="block space-y-1 text-sm">
                Class and subject
                <Select value={draft.pair} onValueChange={(v) => setDraft({ ...draft, pair: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pairs.map((p) => (
                      <SelectItem key={pairKey(p.gradeId, p.subjectId)} value={pairKey(p.gradeId, p.subjectId)}>
                        {p.gradeCode} · {p.subjectName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1 text-sm">
                  Type
                  <Select
                    value={draft.type}
                    onValueChange={(v) => setDraft({ ...draft, type: v as QuestionType, answer: v === "true_false" ? "True" : "" })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-sm">
                  Difficulty
                  <Select value={draft.difficulty} onValueChange={(v) => setDraft({ ...draft, difficulty: v as Difficulty })}>
                    <SelectTrigger className="w-full capitalize">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIFFICULTIES.map((d) => (
                        <SelectItem key={d} value={d} className="capitalize">
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1 text-sm">
                  Marks
                  <Input type="number" min={0.01} max={100} step="0.5" required value={draft.marks} onChange={(e) => setDraft({ ...draft, marks: e.target.value })} className="tabular-nums" />
                </label>
              </div>
              <label className="block space-y-1 text-sm">
                Question
                <Textarea required rows={3} maxLength={4000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
              </label>
              {draft.type === "mcq" && (
                <fieldset className="space-y-2">
                  <legend className="text-sm">Options (pick the correct one)</legend>
                  {draft.options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="correct"
                        aria-label={`Option ${i + 1} is correct`}
                        checked={opt.trim() !== "" && draft.answer === opt}
                        onChange={() => setDraft({ ...draft, answer: opt })}
                        disabled={opt.trim() === ""}
                      />
                      <Input
                        value={opt}
                        maxLength={500}
                        placeholder={`Option ${i + 1}`}
                        onChange={(e) => {
                          const options = draft.options.map((o, j) => (j === i ? e.target.value : o));
                          setDraft({ ...draft, options, answer: draft.answer === opt ? e.target.value : draft.answer });
                        }}
                      />
                    </div>
                  ))}
                </fieldset>
              )}
              {draft.type === "true_false" && (
                <label className="block space-y-1 text-sm">
                  Correct answer
                  <Select value={draft.answer || "True"} onValueChange={(v) => setDraft({ ...draft, answer: v })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="True">True</SelectItem>
                      <SelectItem value="False">False</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              )}
              {(draft.type === "short_answer" || draft.type === "long_answer") && (
                <label className="block space-y-1 text-sm">
                  Model answer
                  <Textarea required rows={3} maxLength={4000} value={draft.answer} onChange={(e) => setDraft({ ...draft, answer: e.target.value })} />
                </label>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Saving…" : "Save question"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
