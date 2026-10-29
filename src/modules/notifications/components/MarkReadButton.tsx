"use client";

// Same `useActionState` + hidden-field form pattern as
// src/app/(tenant)/[institution]/jobs/requeue-button.tsx.
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actions/result";
import { markRead } from "@/modules/notifications/actions";

export function MarkReadButton({ institutionSlug, notificationId }: { institutionSlug: string; notificationId: string }) {
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prevState, formData) => markRead(institutionSlug, { notificationId: formData.get("notificationId") }),
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="notificationId" value={notificationId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? "Marking…" : "Mark read"}
      </Button>
      {state && !state.ok && (
        <span role="alert" className="text-destructive text-xs">
          {state.error.message}
        </span>
      )}
    </form>
  );
}
