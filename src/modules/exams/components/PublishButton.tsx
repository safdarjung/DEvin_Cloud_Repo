"use client";

// T-019 — rule 5: disabled until verification is clean, and its confirm
// dialog states the action cannot be undone. The server action
// (publishExamResults) re-checks verification regardless (app.exam_write_roles
// + app.exam_verification inside app.publish_exam_results) — this disabled
// state is a UX nicety, never the real gate.
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
import { publishExamResults } from "@/modules/exams/actions";

interface PublishButtonProps {
  institutionSlug: string;
  examId: string;
  verificationClean: boolean;
}

export function PublishButton({ institutionSlug, examId, verificationClean }: PublishButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionResult<{ exam_id: string; result_count: number }> | null, FormData>(
    async () => {
      const result = await publishExamResults(institutionSlug, { examId });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" disabled={!verificationClean || pending}>
          {pending ? "Publishing…" : "Publish results"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish results?</DialogTitle>
          <DialogDescription>
            This cannot be undone; corrections are only possible via recheck.
          </DialogDescription>
        </DialogHeader>
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
            <Button type="submit" disabled={pending}>
              {pending ? "Publishing…" : "Confirm publish"}
            </Button>
          </form>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
