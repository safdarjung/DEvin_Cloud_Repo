"use client";

// Status / run / approval controls. Hiding them is UX only: every action re-checks workflow.manage.
// Run now and approve/reject run the workflow in the request; the result opens in a dialog.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { decideWorkflowRun, runWorkflowNow, setWorkflowStatus, type WorkflowRunResult } from "@/modules/workflows/actions";
import { RUN_STATUS_VARIANT, RunSteps, RunTimes, runStatusText } from "@/modules/workflows/components/run-steps";

function useCall() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function call<T>(fn: () => Promise<ActionResult<T>>, ok: string | null, onOk?: (data: T) => void) {
    start(async () => {
      const res = await fn();
      if (!res.ok) return void toast.error(describeActionError(res.error));
      if (ok) toast.success(ok);
      onOk?.(res.data);
      router.refresh();
    });
  }
  return { pending, call };
}

function RunResultDialog({ result, labels, runsHref, onClose }: { result: WorkflowRunResult | null; labels: Record<string, string>; runsHref: string; onClose: () => void }) {
  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {result && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                Run result <Badge variant={RUN_STATUS_VARIANT[result.status] ?? "outline"}>{runStatusText(result.status)}</Badge>
              </DialogTitle>
              <DialogDescription asChild>
                <div>
                  <RunTimes startedAt={result.startedAt} finishedAt={result.finishedAt} />
                </div>
              </DialogDescription>
            </DialogHeader>
            {result.queued && (
              <p role="status" className="rounded-md border border-dashed p-2 text-sm">
                {result.status === "running"
                  ? "This run did not finish in time here. It continues in the background; check Runs for the result."
                  : "This run is waiting for the background runner. Check Runs for the result."}
              </p>
            )}
            {result.status === "awaiting_approval" && <p className="text-sm">Waiting for an approver: approve or reject it under Runs.</p>}
            <RunSteps steps={result.steps} labels={labels} />
            <Link className="text-sm underline" href={runsHref}>
              See all runs
            </Link>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function WorkflowRowControls({
  institutionSlug,
  id,
  name,
  status,
  triggerType,
  steps,
  labels,
  editHref,
  runsHref,
}: {
  institutionSlug: string;
  id: string;
  name: string;
  status: string;
  triggerType: string;
  steps: number;
  labels: Record<string, string>;
  editHref: string;
  runsHref: string;
}) {
  const { pending, call } = useCall();
  const [result, setResult] = useState<WorkflowRunResult | null>(null);
  const set = (to: "active" | "paused" | "disabled", ok: string) => call(() => setWorkflowStatus(institutionSlug, { id, status: to }), ok);
  const runNow = () => call(() => runWorkflowNow(institutionSlug, { id }), null, setResult);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {status === "active" ? (
        <>
          {triggerType !== "event" && (
            <Button type="button" size="sm" disabled={pending} aria-label={`Run ${name} now`} onClick={runNow}>
              {pending ? "Running…" : "Run now"}
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={`Pause ${name}`} onClick={() => set("paused", "Paused")}>
            Pause
          </Button>
        </>
      ) : (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || steps === 0}
            title={steps === 0 ? "Add a step before turning it on" : undefined}
            aria-label={`Turn on ${name}`}
            onClick={() => set("active", "Turned on")}
          >
            Turn on
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={editHref} aria-label={`Edit ${name}`}>
              Edit
            </Link>
          </Button>
        </>
      )}
      {status !== "disabled" && status !== "active" && (
        <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={`Disable ${name}`} onClick={() => set("disabled", "Disabled")}>
          Disable
        </Button>
      )}
      <RunResultDialog result={result} labels={labels} runsHref={runsHref} onClose={() => setResult(null)} />
    </div>
  );
}

export function DecideRunForm({ institutionSlug, runId, prompt, labels, runsHref }: { institutionSlug: string; runId: string; prompt: string; labels: Record<string, string>; runsHref: string }) {
  const { pending, call } = useCall();
  const [note, setNote] = useState("");
  const [result, setResult] = useState<WorkflowRunResult | null>(null);
  const decide = (decision: "approve" | "reject") =>
    call(() => decideWorkflowRun(institutionSlug, { runId, decision, ...(note.trim() ? { note: note.trim() } : {}) }), decision === "approve" ? "Approved" : "Rejected", setResult);
  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending}>
      <div>
        <Label htmlFor={`note-${runId}`}>Note (optional) for: {prompt}</Label>
        <Input id={`note-${runId}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="w-64" />
      </div>
      <Button type="button" size="sm" disabled={pending} onClick={() => decide("approve")}>
        {pending ? "Working…" : "Approve"}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide("reject")}>
        Reject
      </Button>
      <RunResultDialog result={result} labels={labels} runsHref={runsHref} onClose={() => setResult(null)} />
    </div>
  );
}
