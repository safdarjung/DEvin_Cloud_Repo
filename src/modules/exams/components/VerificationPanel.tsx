"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import { closeMarksEntry, openMarksEntry, reopenMarksEntry, verifyExam } from "@/modules/exams/actions";

interface VerificationResult {
  missing: Array<{ exam_paper_id: string; class_section_id: string; subject_id: string; student_id: string }>;
  outOfRange: Array<{ exam_paper_id: string; student_id: string; marks_obtained: number; max_marks: number }>;
  summary: { missingCount: number; outOfRangeCount: number; clean: boolean };
}

interface VerificationPanelProps {
  institutionSlug: string;
  examId: string;
  examStatus: string;
  hasPapers: boolean;
  initialVerification: VerificationResult | null;
}

function TransitionButton({
  label,
  pending,
  disabled,
}: {
  label: string;
  pending: boolean;
  disabled?: boolean;
}) {
  return (
    <Button type="submit" size="sm" variant="outline" disabled={pending || disabled}>
      {pending ? `${label}…` : label}
    </Button>
  );
}

/** 06 §W7's verification panel — missing/out-of-range counts, and the status-transition buttons the diagram names (draft->marks_entry->verification->marks_entry). Publish itself is T-019's. */
export function VerificationPanel({ institutionSlug, examId, examStatus, hasPapers, initialVerification }: VerificationPanelProps) {
  const router = useRouter();
  const [verification, setVerification] = useState(initialVerification);

  const [verifyState, verifyAction, verifying] = useActionState<ActionResult<VerificationResult> | null, FormData>(
    async () => {
      const result = await verifyExam(institutionSlug, { examId });
      if (result.ok) setVerification(result.data);
      return result;
    },
    null,
  );

  const [openState, openAction, opening] = useActionState<ActionResult<unknown> | null, FormData>(
    async () => openMarksEntry(institutionSlug, { examId }),
    null,
  );
  const [closeState, closeAction, closing] = useActionState<ActionResult<unknown> | null, FormData>(
    async () => closeMarksEntry(institutionSlug, { examId }),
    null,
  );
  const [reopenState, reopenAction, reopening] = useActionState<ActionResult<unknown> | null, FormData>(
    async () => reopenMarksEntry(institutionSlug, { examId }),
    null,
  );

  // Bug fix (Batch C): was called unconditionally during render ("Cannot
  // update a component (Router) while rendering a different component") —
  // a status-transition result is a side effect, so it belongs in an effect.
  useEffect(() => {
    if (openState?.ok || closeState?.ok || reopenState?.ok) {
      router.refresh();
    }
  }, [openState, closeState, reopenState, router]);

  const transitionError = [openState, closeState, reopenState].find((s) => s && !s.ok) as
    | { ok: false; error: { message: string } }
    | undefined;

  return (
    <div className="space-y-4 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Verification</h2>
        <Badge variant={examStatus === "published" ? "default" : "secondary"}>{examStatus}</Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        {examStatus === "draft" && (
          <form action={openAction}>
            <TransitionButton label="Open marks entry" pending={opening} disabled={!hasPapers} />
          </form>
        )}
        {examStatus === "marks_entry" && (
          <form action={closeAction}>
            <TransitionButton label="Close marks entry" pending={closing} />
          </form>
        )}
        {examStatus === "verification" && (
          <form action={reopenAction}>
            <TransitionButton label="Reopen marks entry" pending={reopening} />
          </form>
        )}
        <form action={verifyAction}>
          <TransitionButton label="Check verification" pending={verifying} />
        </form>
      </div>

      {transitionError && (
        <p role="alert" className="text-destructive text-sm">
          {transitionError.error.message}
        </p>
      )}
      {verifyState && !verifyState.ok && (
        <p role="alert" className="text-destructive text-sm">
          {verifyState.error.message}
        </p>
      )}

      {verification && (
        <div className="space-y-2 text-sm">
          <p>
            {verification.summary.clean
              ? "Clean — every enrolled student has marks within range."
              : `${verification.summary.missingCount} missing, ${verification.summary.outOfRangeCount} out of range.`}
          </p>
          {verification.missing.length > 0 && (
            <p className="text-muted-foreground">
              {verification.missing.length} student{verification.missing.length === 1 ? "" : "s"} still need marks entered.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
