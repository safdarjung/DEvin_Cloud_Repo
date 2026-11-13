"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { cancelTest, closeTest, publishTestResults, pushToMarksEntry, scheduleTest, updateTest } from "@/modules/online-tests/actions";
import type { TestDetail } from "@/modules/online-tests/queries";
import { inWindow, nowMs, run, toLocalInput } from "./test-ui";

type PushData = { papers: { sectionId: string; examPaperId: string; entered: number; unchanged: number }[]; notAttempted: number; notEnrolled: { studentId: string; studentName: string }[] };

export function TestControls({ slug, test, sectionLabels, canPublish, canPush }: { slug: string; test: TestDetail; sectionLabels: Record<string, string>; canPublish: boolean; canPush: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(test.title);
  const [closesAt, setClosesAt] = useState(toLocalInput(test.closesAt));
  const [push, setPush] = useState<PushData | null>(null);
  const [pushErrors, setPushErrors] = useState<string[]>([]);
  const editable = test.status === "draft" || test.status === "scheduled" || test.status === "open";
  const afterClose = test.status === "closed" || test.status === "evaluating" || test.status === "published";

  async function act<T>(fn: () => Promise<import("@/lib/actions/result").ActionResult<T>>, done: string) {
    setBusy(true);
    const r = await run(fn());
    setBusy(false);
    if (r) { toast.success(done); router.refresh(); }
  }

  async function save() {
    await act(() => updateTest(slug, { id: test.id, title, closesAt: new Date(closesAt).toISOString() }), "Saved");
  }

  async function doPush() {
    setBusy(true);
    setPushErrors([]);
    const r = await pushToMarksEntry(slug, { id: test.id });
    setBusy(false);
    if (!r.ok) {
      const lines = Object.entries(r.error.fieldErrors ?? {}).map(([sid, msgs]) => `${sectionLabels[sid] ?? sid}: ${msgs.join(" ")}`);
      setPushErrors(lines.length ? lines : [actionErrorMessage(r.error)]);
      return;
    }
    setPush(r.data);
    toast.success("Marks sent to marks entry");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" data-testid="test-actions">
        {test.status === "draft" && <Button disabled={busy} onClick={() => act(() => scheduleTest(slug, { id: test.id }), "Scheduled")}>Schedule</Button>}
        {(test.status === "draft" || test.status === "scheduled") && (
          <Button variant="outline" disabled={busy} onClick={() => { if (confirm("Cancel this test?")) void act(() => cancelTest(slug, { id: test.id }), "Cancelled"); }}>Cancel test</Button>
        )}
        {(test.status === "open" || (test.status === "scheduled" && inWindow(test, nowMs()))) && <Button variant="outline" disabled={busy} onClick={() => { if (confirm("Close the test now? Students still writing are submitted.")) void act(() => closeTest(slug, { id: test.id }), "Closed"); }}>Close now</Button>}
        {afterClose && test.status !== "published" && canPublish && (
          <Button disabled={busy} onClick={() => { if (confirm("Publish results to students and guardians?")) void act(() => publishTestResults(slug, { id: test.id }), "Results published"); }}>Publish results</Button>
        )}
        {afterClose && !test.practice && canPush && <Button variant="secondary" disabled={busy} onClick={doPush}>Send to marks entry</Button>}
      </div>

      {test.needsRepush && (
        <div role="alert" data-testid="repush-banner" className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          Marks changed after the last send to marks entry, so the official marks are out of date. Send them again.
        </div>
      )}
      {test.marksPushedAt && !test.needsRepush && <p className="text-xs text-muted-foreground">Official marks are up to date.</p>}
      {pushErrors.length > 0 && (
        <ul role="alert" className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" data-testid="push-errors">
          {pushErrors.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      {push && (
        <div className="rounded-lg border bg-card p-3 text-sm" data-testid="push-result">
          <p className="font-medium">Sent to marks entry</p>
          <ul className="mt-1 list-disc pl-5">
            {push.papers.map((p) => <li key={p.sectionId}>{sectionLabels[p.sectionId] ?? "Class"}: {p.entered} entered, {p.unchanged} unchanged</li>)}
          </ul>
          <p className="mt-1">{push.notAttempted} not attempted.</p>
          {push.notEnrolled.length > 0 && <p className="mt-1">Not enrolled in these classes, not sent: {push.notEnrolled.map((s) => s.studentName).join(", ")}.</p>}
        </div>
      )}

      {editable && (
        <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-3 sm:items-end">
          <div className="space-y-1"><Label>Title</Label><Input aria-label="Test title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="space-y-1"><Label>Closes at</Label><Input aria-label="Test closes at" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></div>
          <Button variant="outline" disabled={busy} onClick={save}>Save changes</Button>
        </div>
      )}
    </div>
  );
}
