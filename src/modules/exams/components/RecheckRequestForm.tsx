"use client";

// T-020 — per-paper "Request recheck" affordance on ReportCard (06 §W8),
// guardian/student only. `app.request_recheck` (20261028000022) re-checks
// everything this form can't (ownership, the window, the one-open-request
// rule) — this is UX, never the real gate.
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actions/result";
import { requestRecheck } from "@/modules/exams/actions";

interface RecheckRequestFormProps {
  institutionSlug: string;
  resultId: string;
  examPaperId: string;
  subjectName: string;
}

const MIN_REASON_LENGTH = 10;

export function RecheckRequestForm({ institutionSlug, resultId, examPaperId, subjectName }: RecheckRequestFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, action, pending] = useActionState<ActionResult<{ request_id: string; status: string }> | null, FormData>(
    async () => {
      const result = await requestRecheck(institutionSlug, { resultId, examPaperId, reason });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    null,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setReason("");
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-10 sm:h-7">
          Request recheck
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request a recheck — {subjectName}</DialogTitle>
          <DialogDescription>
            Explain why this paper should be rechecked (10–1000 characters). The exam cell will review and decide.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          minLength={MIN_REASON_LENGTH}
          maxLength={1000}
          aria-label="Reason for recheck"
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {state && !state.ok && (
          <p role="alert" className="text-destructive text-sm">
            {state.error.message}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <form action={action}>
            <Button type="submit" disabled={pending || reason.trim().length < MIN_REASON_LENGTH}>
              {pending ? "Submitting…" : "Submit request"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
