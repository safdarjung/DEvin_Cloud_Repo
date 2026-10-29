"use client";

// T-020 — `/exams/rechecks/[requestId]` review + decide (06 §W8).
// `start_recheck_review`/`apply_recheck_decision` (20261028000022/0009) do
// every real check (role, state transition, marks range) — this is UX,
// never the real gate.
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions/result";
import { decideRecheck, startRecheckReview } from "@/modules/exams/actions";
import type { RecheckQueueRow } from "@/modules/exams/queries";

interface RecheckDecisionFormProps {
  institutionSlug: string;
  request: RecheckQueueRow;
}

export function RecheckDecisionForm({ institutionSlug, request }: RecheckDecisionFormProps) {
  const router = useRouter();
  const [decision, setDecision] = useState<"approve" | "reject">("approve");
  const [newMarks, setNewMarks] = useState("");
  const [note, setNote] = useState("");

  const [startState, startAction, startPending] = useActionState<
    ActionResult<{ request_id: string; status: string }> | null,
    FormData
  >(async () => {
    const result = await startRecheckReview(institutionSlug, { requestId: request.id });
    if (result.ok) router.refresh();
    return result;
  }, null);

  const [decideState, decideAction, decidePending] = useActionState<
    ActionResult<{ request_id: string; decision: string }> | null,
    FormData
  >(async () => {
    const result = await decideRecheck(institutionSlug, {
      requestId: request.id,
      decision,
      newMarks: decision === "approve" ? Number(newMarks) : undefined,
      note: note.trim() === "" ? undefined : note.trim(),
    });
    if (result.ok) router.refresh();
    return result;
  }, null);

  if (request.status === "submitted") {
    return (
      <form action={startAction} className="space-y-2">
        {startState && !startState.ok && (
          <p role="alert" className="text-destructive text-sm">
            {startState.error.message}
          </p>
        )}
        <Button type="submit" disabled={startPending}>
          {startPending ? "Starting…" : "Start review"}
        </Button>
      </form>
    );
  }

  if (request.status !== "under_review") {
    return <p className="text-muted-foreground text-sm">This request has already been decided.</p>;
  }

  return (
    <form action={decideAction} className="space-y-3">
      <fieldset className="flex gap-4">
        <label className="flex items-center gap-1 text-sm">
          <input
            type="radio"
            name="decision"
            checked={decision === "approve"}
            onChange={() => setDecision("approve")}
          />
          Approve
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="radio" name="decision" checked={decision === "reject"} onChange={() => setDecision("reject")} />
          Reject
        </label>
      </fieldset>

      {decision === "approve" && (
        <label className="block text-sm">
          New marks (/{request.maxMarks})
          <Input
            type="number"
            min={0}
            max={request.maxMarks}
            step="0.01"
            value={newMarks}
            onChange={(e) => setNewMarks(e.target.value)}
            className="mt-1 w-32"
          />
        </label>
      )}

      <label className="block text-sm">
        Note
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>

      {decideState && !decideState.ok && (
        <p role="alert" className="text-destructive text-sm">
          {decideState.error.message}
        </p>
      )}

      <Button type="submit" disabled={decidePending || (decision === "approve" && newMarks.trim() === "")}>
        {decidePending ? "Submitting…" : `Confirm ${decision}`}
      </Button>
    </form>
  );
}
