"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { finaliseAttempt, saveMarks, suggestMarks } from "@/modules/online-tests/actions";
import type { MarkingQueue, QueueItem } from "@/modules/online-tests/queries";
import { ATTEMPT_LABEL, fmtNum, run } from "./test-ui";

function ItemCard({ slug, item, studentName, onSaved }: { slug: string; item: QueueItem; studentName: string; onSaved: () => void }) {
  const [marks, setMarks] = useState(item.teacherMarks === null ? "" : String(item.teacherMarks));
  const [feedback, setFeedback] = useState(item.teacherFeedback ?? "");
  const [ai, setAi] = useState(item.aiSuggestedMarks === null ? null : { marks: item.aiSuggestedMarks, feedback: item.aiFeedback ?? "" });
  const [busy, setBusy] = useState<"ai" | "save" | null>(null);
  const [saved, setSaved] = useState(item.teacherMarks !== null);
  const n = Number(marks);
  const invalid = marks.trim() === "" || !Number.isFinite(n) || n < 0 || n > item.marks;

  async function suggest() {
    setBusy("ai");
    const r = await run(suggestMarks(slug, { responseId: item.responseId }));
    setBusy(null);
    if (r) setAi({ marks: r.aiSuggestedMarks, feedback: r.aiFeedback });
  }
  async function save() {
    setBusy("save");
    const r = await run(saveMarks(slug, { responseId: item.responseId, marks: n, feedback: feedback.trim() || null }));
    setBusy(null);
    if (r) { setSaved(true); toast.success("Marks saved"); onSaved(); }
  }

  return (
    <li className="space-y-3 rounded-lg border bg-card p-4" data-testid="mark-item">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{studentName}</p>
        <Badge variant={saved ? "success" : "warning"}>{saved ? "Marked" : "To mark"}</Badge>
      </div>
      <div className="whitespace-pre-wrap text-sm">{item.body} <span className="text-muted-foreground">[{fmtNum(item.marks)} marks]</span></div>
      {(item.markingScheme || item.expectedAnswer) && (
        <div className="rounded-md bg-muted/50 p-2 text-xs">
          {item.markingScheme && <p><span className="font-medium">Marking scheme:</span> {item.markingScheme}</p>}
          {item.expectedAnswer && <p><span className="font-medium">Expected answer:</span> {item.expectedAnswer}</p>}
        </div>
      )}
      <div className="rounded-md border border-dashed p-2 text-sm">
        <p className="mb-1 text-xs font-medium text-muted-foreground">Student answer</p>
        <p className="whitespace-pre-wrap" data-testid="student-answer">{item.answer}</p>
      </div>
      {ai && (
        <div className="rounded-md border border-info/40 bg-info/10 p-2 text-sm" data-testid="ai-suggestion">
          <p className="text-xs font-medium">AI suggestion, not saved. You decide the marks.</p>
          <p>Suggested: {fmtNum(ai.marks)} / {fmtNum(item.marks)}</p>
          <p className="text-muted-foreground">{ai.feedback}</p>
          <Button size="sm" variant="outline" className="mt-1" onClick={() => { setMarks(String(ai.marks)); setFeedback(ai.feedback); }}>Use suggestion</Button>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[8rem_1fr_auto_auto] sm:items-end">
        <label className="space-y-1 text-xs font-medium">Marks (max {fmtNum(item.marks)})
          <Input aria-label="Marks" type="number" min={0} max={item.marks} step={0.5} value={marks} onChange={(e) => { setMarks(e.target.value); setSaved(false); }} />
        </label>
        <label className="space-y-1 text-xs font-medium">Feedback
          <Textarea aria-label="Feedback" rows={1} value={feedback} maxLength={2000} onChange={(e) => { setFeedback(e.target.value); setSaved(false); }} />
        </label>
        <Button variant="outline" disabled={busy !== null} onClick={suggest}>{busy === "ai" ? "Thinking..." : "Suggest with AI"}</Button>
        <Button disabled={busy !== null || invalid} onClick={save}>{busy === "save" ? "Saving..." : "Save marks"}</Button>
      </div>
    </li>
  );
}

export function MarkingView({ slug, queue }: { slug: string; queue: MarkingQueue }) {
  const router = useRouter();
  const [onlyPending, setOnlyPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const names = new Map(queue.attempts.map((a) => [a.attemptId, a.studentName]));
  const items = queue.items.filter((i) => !onlyPending || i.teacherMarks === null);

  async function finalise(ids: string[]) {
    setBusy(true);
    let done = 0;
    for (const attemptId of ids) {
      const r = await run(finaliseAttempt(slug, { attemptId }));
      if (r) done += 1;
    }
    setBusy(false);
    if (done) { toast.success(`Finalised ${done} attempt${done > 1 ? "s" : ""}`); router.refresh(); }
  }
  const ready = queue.attempts.filter((a) => a.status !== "evaluated" && a.pending === 0).map((a) => a.attemptId);

  return (
    <div className="space-y-6">
      <section aria-labelledby="att-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="att-h" className="text-base font-semibold">Attempts</h2>
          <Button size="sm" disabled={busy || ready.length === 0} onClick={() => finalise(ready)}>Finalise all ready ({ready.length})</Button>
        </div>
        {queue.attempts.length === 0 ? <p className="text-sm text-muted-foreground">No submitted attempts yet.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Student</th><th className="font-medium">Status</th><th className="font-medium">To mark</th><th className="font-medium">Score</th><th /></tr></thead>
            <tbody>
              {queue.attempts.map((a) => (
                <tr key={a.attemptId} className="border-b" data-testid="queue-attempt">
                  <td className="py-1.5">{a.studentName}</td>
                  <td>{ATTEMPT_LABEL[a.status]}</td>
                  <td>{a.pending}</td>
                  <td className="tabular-nums">{fmtNum(a.totalScore)}</td>
                  <td className="text-right">
                    {a.status !== "evaluated" && <Button size="sm" variant="outline" disabled={busy || a.pending > 0} title={a.pending > 0 ? "Mark every written answer first" : undefined} onClick={() => finalise([a.attemptId])}>Finalise</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section aria-labelledby="wr-h">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="wr-h" className="text-base font-semibold">Written answers ({queue.items.length})</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> Only unmarked</label>
        </div>
        {items.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to mark.</p> : (
          <ul className="space-y-3">
            {items.map((i) => <ItemCard key={i.responseId} slug={slug} item={i} studentName={names.get(i.attemptId) ?? ""} onSaved={() => router.refresh()} />)}
          </ul>
        )}
      </section>
    </div>
  );
}
