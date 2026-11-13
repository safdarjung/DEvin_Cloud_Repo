"use client";

// Phase 2: AI question drafts grounded in the school's own read textbook text.
// Nothing is saved until the teacher selects drafts; each goes through
// createQuestion with origin "ai", which stores it as a draft for review.
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { postAiTask } from "@/modules/ai/components/ai-task-fetch";
import type { SourceRef } from "@/modules/content/grounding";
import { createQuestion } from "@/modules/question-bank/actions";
import type { QuestionCreateInput } from "@/modules/question-bank/schemas";
import { DIFFICULTIES, TYPES, pairKey, typeLabel, type PairMeta } from "./question-meta";

// Mirrors GROUNDED_TYPES in content/grounding.ts (not imported: that file is server-side).
const GROUNDED = ["mcq", "true_false", "very_short_answer", "short_answer", "long_answer", "fill_blank", "multi_select", "assertion_reason"];
const OPTIONS = TYPES.filter((t) => GROUNDED.includes(t.value));
const ANY = "any";

interface Response {
  grounded: boolean;
  note: string | null;
  sources: SourceRef[];
  drafts: QuestionCreateInput[];
  dropped: number;
  provider: string | null;
  model: string | null;
}

/** "1, 3-5" -> [1,3,4,5]; null when the text is not a chapter list. */
function parseChapters(text: string): number[] | null {
  const out = new Set<number>();
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/.exec(part);
    if (!m) return null;
    const [a, b] = [Number(m[1]), Number(m[2] ?? m[1])];
    if (a < 1 || b < a || b > 99 || b - a > 19) return null;
    for (let n = a; n <= b; n += 1) out.add(n);
  }
  return [...out].slice(0, 20);
}

export function GenerateFromTextbook({ institutionSlug, pairs, onSaved }: { institutionSlug: string; pairs: PairMeta[]; onSaved: () => void }) {
  const [pairIdx, setPairIdx] = useState(0);
  const pair = pairs[pairIdx];
  const [bookId, setBookId] = useState(ANY);
  const [chapters, setChapters] = useState("");
  const [unitId, setUnitId] = useState(ANY);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>(["mcq", "short_answer"]);
  const [count, setCount] = useState("5");
  const [marks, setMarks] = useState("2");
  const [difficulty, setDifficulty] = useState("medium");
  const [ungrounded, setUngrounded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Response | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [saved, setSaved] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  if (!pair) return null;
  const topics = pair.topics.filter((t) => unitId === ANY || t.unitId === unitId);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function generate() {
    const chapterNos = chapters.trim() ? parseChapters(chapters) : undefined;
    if (chapterNos === null) return void setError('Chapters look like "1, 3-5".');
    const n = Number(count);
    const m = Number(marks);
    if (!Number.isInteger(n) || n < 1 || n > 10) return void setError("Ask for 1 to 10 questions.");
    if (!(m > 0 && m <= 100)) return void setError("Marks each must be more than 0 and at most 100.");
    if (types.length === 0) return void setError("Pick at least one question type.");
    setBusy(true);
    setError(null);
    setResult(null);
    setPicked([]);
    setSaved([]);
    const res = await postAiTask<Response>("/api/ai/questions-generate", {
      institutionSlug,
      gradeId: pair.gradeId,
      subjectId: pair.subjectId,
      ...(bookId !== ANY ? { subjectTextbookId: bookId } : {}),
      ...(chapterNos?.length ? { chapterNos } : {}),
      ...(unitId !== ANY ? { curriculumUnitId: unitId } : {}),
      ...(topicIds.length ? { topicIds } : {}),
      types,
      count: n,
      marksEach: m,
      difficulty,
      allowUngrounded: ungrounded,
    });
    setBusy(false);
    if (!res.ok) return void setError(res.message);
    setResult(res.data);
    setPicked(res.data.drafts.map((_, i) => i));
  }

  async function saveSelected() {
    if (!result) return;
    setSaving(true);
    const done: number[] = [];
    for (const i of picked) {
      if (saved.includes(i)) continue;
      const r = await createQuestion(institutionSlug, result.drafts[i]);
      if (!r.ok) {
        toast.error(actionErrorMessage(r.error));
        break;
      }
      done.push(i);
    }
    setSaving(false);
    if (done.length) {
      setSaved((s) => [...s, ...done]);
      toast.success(`${done.length} draft${done.length === 1 ? "" : "s"} saved for review`);
      onSaved();
    }
  }

  const label = "block space-y-1 text-sm";
  return (
    <Card>
      <CardHeader><CardTitle>Generate from a textbook</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Questions are written from the text of your school&apos;s own books that have been read (Textbooks page). Nothing is saved until you select drafts; saved drafts wait for review.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>Grade and subject
            <Select value={String(pairIdx)} onValueChange={(v) => { setPairIdx(Number(v)); setBookId(ANY); setUnitId(ANY); setTopicIds([]); setResult(null); }}>
              <SelectTrigger aria-label="Grade and subject"><SelectValue /></SelectTrigger>
              <SelectContent>{pairs.map((p, i) => <SelectItem key={pairKey(p.gradeId, p.subjectId)} value={String(i)}>{p.gradeCode} · {p.subjectName}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className={label}>Book
            <Select value={bookId} onValueChange={setBookId}>
              <SelectTrigger aria-label="Book"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any book of this subject</SelectItem>
                {pair.books.map((b) => <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className={label}>Chapters (optional)
            <Input aria-label="Chapters" placeholder="e.g. 1, 3-5" value={chapters} onChange={(e) => setChapters(e.target.value)} />
          </label>
          <label className={label}>Curriculum unit (optional)
            <Select value={unitId} onValueChange={(v) => { setUnitId(v); setTopicIds([]); }}>
              <SelectTrigger aria-label="Curriculum unit"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY}>Any unit</SelectItem>
                {pair.units.map((u) => <SelectItem key={u.id} value={u.id}>{u.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        </div>
        {topics.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Topics (optional)</legend>
            <div className="flex max-h-32 flex-wrap gap-x-4 gap-y-1 overflow-y-auto">
              {topics.map((t) => (
                <label key={t.id} className="flex min-h-8 items-center gap-1.5"><input type="checkbox" checked={topicIds.includes(t.id)} onChange={() => setTopicIds((l) => toggle(l, t.id))} />{t.title}</label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Question types</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {OPTIONS.map((t) => (
              <label key={t.value} className="flex min-h-8 items-center gap-1.5"><input type="checkbox" checked={types.includes(t.value)} onChange={() => setTypes((l) => toggle(l, t.value))} />{t.label}</label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>How many (1-10)<Input type="number" min={1} max={10} className="w-24" value={count} onChange={(e) => setCount(e.target.value)} /></label>
          <label className={label}>Marks each<Input type="number" min={0.5} step={0.5} className="w-24" value={marks} onChange={(e) => setMarks(e.target.value)} /></label>
          <label className={label}>Difficulty
            <Select value={difficulty} onValueChange={setDifficulty}>
              <SelectTrigger className="w-32" aria-label="Difficulty"><SelectValue /></SelectTrigger>
              <SelectContent>{DIFFICULTIES.map((d) => <SelectItem key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</SelectItem>)}</SelectContent>
            </Select>
          </label>
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={ungrounded} onChange={(e) => setUngrounded(e.target.checked)} />If the books have no matching text, write the questions from general knowledge instead (not grounded in your textbook)</label>
        <Button type="button" onClick={() => void generate()} disabled={busy}>{busy ? "Writing questions…" : "Generate drafts"}</Button>
        {error && <p role="alert" className="text-destructive">{error}</p>}

        {result && (
          <div className="space-y-3 border-t pt-3" data-testid="generated">
            <div className="flex flex-wrap items-center gap-2">
              {result.grounded ? <Badge variant="success">Grounded in your textbook</Badge> : <Badge variant="warning">Not grounded in a textbook</Badge>}
              {result.model && <span className="text-xs text-muted-foreground">{result.provider} · {result.model}</span>}
            </div>
            {result.note && <p role="status" className="rounded-md border border-warning/40 bg-warning/10 p-2">{result.note}</p>}
            {result.sources.length > 0 && (
              <div>
                <p className="text-xs font-medium">Written from</p>
                <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
                  {result.sources.map((s) => (
                    <li key={s.chunkId} className="rounded border px-1.5 py-0.5">{s.bookTitle ?? "Textbook"}{s.chapterNo !== null ? ` · ch ${s.chapterNo}` : ""} · {s.pageFrom === s.pageTo ? `p ${s.pageFrom}` : `pp ${s.pageFrom}-${s.pageTo}`}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.drafts.length === 0 ? (
              !result.note && <p className="text-muted-foreground">No usable questions came back{result.dropped ? ` (${result.dropped} dropped as invalid)` : ""}. Try again.</p>
            ) : (
              <>
                <ul className="space-y-2" aria-label="Generated drafts">
                  {result.drafts.map((d, i) => (
                    <li key={i} data-testid="draft" className="rounded-md border bg-card p-3">
                      <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" disabled={saved.includes(i)} checked={picked.includes(i) || saved.includes(i)} onChange={() => setPicked((l) => toggle(l, i))} aria-label={`Select draft ${i + 1}`} />
                        <span className="min-w-0 flex-1 space-y-1">
                          <span className="block whitespace-pre-line">{d.body}</span>
                          {"options" in d && Array.isArray(d.options) && (
                            <ol className="list-[upper-alpha] pl-5 text-muted-foreground">{d.options.map((o, k) => <li key={k}>{o}</li>)}</ol>
                          )}
                          {"answer" in d && d.answer && <span className="block text-xs"><span className="text-muted-foreground">Answer: </span>{d.answer}</span>}
                          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            <Badge variant="outline">{typeLabel(d.type)}</Badge>
                            <span className="tabular-nums">{d.marks} marks</span>
                            {d.sourcePage ? <span className="tabular-nums">Textbook page {d.sourcePage}{d.sourceChapterNo ? `, chapter ${d.sourceChapterNo}` : ""}</span> : <span>No page reference</span>}
                            {saved.includes(i) && <Badge variant="success">Saved as draft</Badge>}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                {result.dropped > 0 && <p className="text-xs text-muted-foreground">{result.dropped} draft{result.dropped === 1 ? " was" : "s were"} dropped because it was not valid.</p>}
                <Button type="button" disabled={saving || picked.filter((i) => !saved.includes(i)).length === 0} onClick={() => void saveSelected()}>
                  {saving ? "Saving…" : `Save ${picked.filter((i) => !saved.includes(i)).length} selected as drafts`}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
