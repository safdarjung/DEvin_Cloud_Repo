"use client";

// Search the school's approved questions for this paper's grade and subject
// (the same questionBank.list query the bank page uses) and add or swap one in.
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { QuestionBankItem } from "@/modules/question-bank/queries";
import { DIFFICULTIES, TYPES, typeLabel } from "@/modules/question-bank/components/question-meta";
import { SELECT_CLASS, fmtMarks } from "./paper-ui";

type Result = { key: string; error: string | null; items: QuestionBankItem[]; total: number };

export function BankPicker({
  institutionSlug,
  gradeId,
  subjectId,
  open,
  single,
  excludeIds,
  busy,
  onClose,
  onPick,
}: {
  institutionSlug: string;
  gradeId: string;
  subjectId: string;
  open: boolean;
  /** Replace mode: one question, then close. */
  single: boolean;
  excludeIds: ReadonlySet<string>;
  busy: boolean;
  onClose: () => void;
  onPick: (questionIds: string[]) => void;
}) {
  const [type, setType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = `${type}|${difficulty}|${nonce}`;

  useEffect(() => {
    if (!open) return;
    let live = true;
    const finish = (r: Omit<Result, "key">) => live && setResult({ key, ...r });
    fetch("/api/v1/query/questionBank.list", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ institution: institutionSlug, input: { gradeId, subjectId, status: "approved", pageSize: 100, ...(type ? { type } : {}), ...(difficulty ? { difficulty } : {}) } }),
    })
      .then((res) => res.json() as Promise<{ ok?: boolean; data?: { items: QuestionBankItem[]; total: number }; error?: { message?: string } }>)
      .then((json) => finish(json.ok && json.data ? { error: null, ...json.data } : { error: json.error?.message ?? "Could not load questions.", items: [], total: 0 }))
      .catch(() => finish({ error: "Could not reach the server.", items: [], total: 0 }));
    return () => { live = false; };
  }, [open, institutionSlug, gradeId, subjectId, type, difficulty, key]);

  const state: { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: QuestionBankItem[]; total: number } =
    !result || result.key !== key ? { kind: "loading" } : result.error ? { kind: "error", message: result.error } : { kind: "ready", items: result.items, total: result.total };

  const needle = text.trim().toLowerCase();
  const items = state.kind === "ready" ? state.items.filter((q) => !needle || q.body.toLowerCase().includes(needle)) : [];
  const toggle = (id: string) => setPicked((p) => (single ? [id] : p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{single ? "Replace with a bank question" : "Add from the question bank"}</DialogTitle>
          <DialogDescription>Approved questions for this class and subject.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input aria-label="Search questions" placeholder="Search text" value={text} onChange={(e) => setText(e.target.value)} />
          <select aria-label="Filter by type" className={SELECT_CLASS} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Any type</option>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select aria-label="Filter by difficulty" className={SELECT_CLASS} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="">Any level</option>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {state.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">Loading questions…</p>}
        {state.kind === "error" && (
          <div role="alert" className="space-y-2 text-sm">
            <p>{state.message}</p>
            <Button size="sm" variant="outline" onClick={() => setNonce((n) => n + 1)}>Try again</Button>
          </div>
        )}
        {state.kind === "ready" && items.length === 0 && <p className="text-sm text-muted-foreground">No approved questions match. Approved questions only; drafts must be approved in the bank first.</p>}
        {state.kind === "ready" && items.length > 0 && (
          <ul className="space-y-1.5" data-testid="bank-results">
            {items.map((q) => {
              const used = excludeIds.has(q.id);
              return (
                <li key={q.id}>
                  <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2 text-sm ${used ? "opacity-50" : "hover:bg-muted/50"}`}>
                    <input type={single ? "radio" : "checkbox"} name="bank-pick" className="mt-1" disabled={used} checked={picked.includes(q.id)} onChange={() => toggle(q.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2">{q.body}</span>
                      <span className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                        <Badge variant="outline">{typeLabel(q.type)}</Badge>
                        <span>{fmtMarks(q.marks)} marks · {q.difficulty}{q.topicTitle ? ` · ${q.topicTitle}` : ""}{used ? " · already in this paper" : ""}</span>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{state.kind === "ready" && state.total > 100 ? "Showing the first 100; narrow the filters." : ""}</p>
          <Button disabled={picked.length === 0 || busy} onClick={() => onPick(picked)}>
            {busy ? "Adding…" : single ? "Use this question" : `Add ${picked.length || ""} question${picked.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
