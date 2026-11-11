"use client";

// features-18 §C #16 — question paper from a marks blueprint on
// /question-bank. Calls /api/ai/question-paper (persists nothing): bank
// questions first, AI drafts only for the gaps. A draft reaches the bank
// only when the teacher clicks "Save to bank" (the bank's createQuestion).
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { AiDraftBadge } from "@/modules/ai/components/AiDraft";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";
import type { DraftQuestion, QuestionPaperResponse } from "@/modules/ai/question-paper.schemas";
import { createQuestion } from "@/modules/question-bank/actions";
import type { TeachingPair } from "@/modules/question-bank/queries";
import type { Difficulty } from "@/modules/question-bank/schemas";

export interface PairUnits extends TeachingPair {
  units: { id: string; title: string }[];
}

interface Row {
  unitId: string;
  difficulty: Difficulty;
  marks: string;
  count: string;
}

const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const newRow = (unitId = ""): Row => ({ unitId, difficulty: "medium", marks: "2", count: "1" });

export function QuestionPaperBuilder({ institutionSlug, pairs }: { institutionSlug: string; pairs: PairUnits[] }) {
  const [pairIndex, setPairIndex] = useState(0);
  const pair = pairs[pairIndex];
  const [rows, setRows] = useState<Row[]>([newRow(pair?.units[0]?.id)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuestionPaperResponse | null>(null);
  const [saved, setSaved] = useState<Set<number>>(new Set());

  const total = Math.round(rows.reduce((sum, r) => sum + Number(r.marks) * Number(r.count), 0) * 100) / 100;
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function build() {
    if (!pair) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setSaved(new Set());
    const response = await postAiTask<QuestionPaperResponse>("/api/ai/question-paper", {
      institutionSlug,
      gradeId: pair.gradeId,
      subjectId: pair.subjectId,
      totalMarks: total,
      rows: rows.map((r) => ({ curriculumUnitId: r.unitId, difficulty: r.difficulty, marks: Number(r.marks), count: Number(r.count) })),
    });
    setBusy(false);
    if (response.ok) setResult(response.data);
    else setError(response.message);
  }

  async function save(draft: DraftQuestion, index: number) {
    const { options, ...rest } = draft;
    const outcome = await createQuestion(institutionSlug, { ...rest, ...(draft.type === "mcq" ? { options } : {}) });
    if (!outcome.ok) {
      toast.error(actionErrorMessage(outcome.error));
      return;
    }
    toast.success("Saved to the question bank");
    setSaved(new Set(saved).add(index));
  }

  if (!pair) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Question paper from a blueprint</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Questions come from the bank first. AI drafts only the slots the bank cannot fill. Nothing is saved unless you save a draft.</p>
        <Select
          value={String(pairIndex)}
          onValueChange={(v) => {
            setPairIndex(Number(v));
            setRows([newRow(pairs[Number(v)].units[0]?.id)]);
            setResult(null);
          }}
        >
          <SelectTrigger className="w-full sm:w-64" aria-label="Grade and subject">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pairs.map((p, i) => (
              <SelectItem key={`${p.gradeId}:${p.subjectId}`} value={String(i)}>
                {p.gradeCode} · {p.subjectName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pair.units.length === 0 ? (
          <p className="text-muted-foreground">No curriculum units for this grade and subject yet.</p>
        ) : (
          <>
            {rows.map((row, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={row.unitId} onValueChange={(v) => setRow(i, { unitId: v })}>
                  <SelectTrigger className="w-full sm:w-56" aria-label={`Row ${i + 1} unit`}>
                    <SelectValue placeholder="Unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {pair.units.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={row.difficulty} onValueChange={(v) => setRow(i, { difficulty: v as Difficulty })}>
                  <SelectTrigger className="w-28" aria-label={`Row ${i + 1} difficulty`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTIES.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" min={0.5} max={100} step={0.5} value={row.marks} onChange={(e) => setRow(i, { marks: e.target.value })} className="w-20" aria-label={`Row ${i + 1} marks each`} />
                <span className="text-muted-foreground">marks ×</span>
                <Input type="number" min={1} max={20} value={row.count} onChange={(e) => setRow(i, { count: e.target.value })} className="w-16" aria-label={`Row ${i + 1} number of questions`} />
                {rows.length > 1 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              {rows.length < 10 && (
                <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, newRow(pair.units[0]?.id)])}>
                  Add row
                </Button>
              )}
              <span className="tabular-nums">Total: {total} marks</span>
              <Button type="button" disabled={busy || rows.some((r) => !r.unitId)} onClick={build}>
                {busy ? "Building…" : "Build paper"}
              </Button>
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {result && (
          <div className="space-y-3">
            <h3 className="font-medium">From the question bank ({result.picked.length})</h3>
            <ol className="list-decimal space-y-1 pl-5">
              {result.picked.map((q) => (
                <li key={q.id}>
                  {q.body} <span className="text-muted-foreground">({q.marks} marks)</span>
                </li>
              ))}
            </ol>
            {result.drafts.length > 0 && (
              <>
                <h3 className="flex flex-wrap items-center gap-2 font-medium">
                  AI drafts ({result.drafts.length}) <AiDraftBadge provider={result.provider} />
                </h3>
                <ol className="list-decimal space-y-2 pl-5">
                  {result.drafts.map((d, i) => (
                    <li key={i} className="space-y-1">
                      <p>
                        {d.body} <span className="text-muted-foreground">({d.marks} marks, {d.difficulty})</span>
                      </p>
                      {d.options.length > 0 && <p className="text-muted-foreground">Options: {d.options.join(" · ")}</p>}
                      <p className="text-muted-foreground">Answer: {d.answer}</p>
                      <Button type="button" variant="outline" size="sm" disabled={saved.has(i)} onClick={() => save(d, i)}>
                        {saved.has(i) ? "Saved" : "Save to bank"}
                      </Button>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {result.unfilled > 0 && (
              <p className="text-muted-foreground">
                {result.unfilled} slot{result.unfilled === 1 ? "" : "s"} still empty.{result.aiNote ? ` ${result.aiNote}` : ""}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
