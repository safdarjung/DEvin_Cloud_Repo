"use client";

// Status / run / approval controls. Hiding them is UX only: every action re-checks workflow.manage.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import type { ActionResult } from "@/lib/actions/result";
import { decideWorkflowRun, runWorkflowNow, setWorkflowStatus } from "@/modules/workflows/actions";

function useCall() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function call<T>(fn: () => Promise<ActionResult<T>>, ok: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const g = res.error.fieldErrors?.graph;
        return void toast.error(g?.length ? `${describeActionError(res.error)} ${g[0]}` : describeActionError(res.error));
      }
      toast.success(ok);
      router.refresh();
    });
  }
  return { pending, call };
}

export function WorkflowRowControls({ institutionSlug, id, name, status, editHref }: { institutionSlug: string; id: string; name: string; status: string; editHref: string }) {
  const { pending, call } = useCall();
  const set = (to: "active" | "paused" | "disabled", ok: string) => call(() => setWorkflowStatus(institutionSlug, { id, status: to }), ok);
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {status === "active" ? (
        <>
          <Button type="button" size="sm" disabled={pending} aria-label={`Run ${name} now`} onClick={() => call(() => runWorkflowNow(institutionSlug, { id }), "Run started")}>
            Run now
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={`Pause ${name}`} onClick={() => set("paused", "Paused")}>
            Pause
          </Button>
        </>
      ) : (
        <>
          <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={`Activate ${name}`} onClick={() => set("active", "Activated")}>
            Activate
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
    </div>
  );
}

export function DecideRunForm({ institutionSlug, runId, prompt }: { institutionSlug: string; runId: string; prompt: string }) {
  const { pending, call } = useCall();
  const [note, setNote] = useState("");
  const decide = (decision: "approve" | "reject") => call(() => decideWorkflowRun(institutionSlug, { runId, decision, ...(note.trim() ? { note: note.trim() } : {}) }), decision === "approve" ? "Approved" : "Rejected");
  return (
    <div className="flex flex-wrap items-end gap-2" aria-busy={pending}>
      <div>
        <Label htmlFor={`note-${runId}`}>Note (optional) for: {prompt}</Label>
        <Input id={`note-${runId}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="w-64" />
      </div>
      <Button type="button" size="sm" disabled={pending} onClick={() => decide("approve")}>
        Approve
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide("reject")}>
        Reject
      </Button>
    </div>
  );
}
