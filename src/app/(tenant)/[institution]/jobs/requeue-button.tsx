"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import { requeueJob } from "@/modules/jobs/actions";

export function RequeueButton({ institutionSlug, jobId }: { institutionSlug: string; jobId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prevState, formData) => requeueJob(institutionSlug, { jobId: formData.get("jobId") }),
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {pending ? "Requeuing…" : "Requeue"}
      </Button>
      {state && !state.ok && (
        <span role="alert" className="text-destructive text-xs">
          {state.error.message}
        </span>
      )}
    </form>
  );
}
