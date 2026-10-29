"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions/result";
import { upsertEvent } from "@/modules/website/actions";

interface EventFormProps {
  institutionSlug: string;
}

// shortcut: create-only, same scope note as NoticeForm.
export function EventForm({ institutionSlug }: EventFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prev, formData) => {
      const startsAtLocal = String(formData.get("startsAt") ?? "");
      const endsAtLocal = String(formData.get("endsAt") ?? "");
      const location = String(formData.get("location") ?? "").trim();
      return upsertEvent(institutionSlug, {
        title: String(formData.get("title") ?? "").trim(),
        startsAt: startsAtLocal ? new Date(startsAtLocal).toISOString() : new Date().toISOString(),
        endsAt: endsAtLocal ? new Date(endsAtLocal).toISOString() : undefined,
        location: location || undefined,
        isPublic: formData.get("isPublic") === "on",
      });
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="max-w-xl space-y-3 rounded-lg border p-4">
      <h2 className="text-sm font-medium">New event</h2>
      <Input name="title" placeholder="Title" required maxLength={200} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-sm font-medium" htmlFor="startsAt">
            Starts at
          </label>
          <Input id="startsAt" name="startsAt" type="datetime-local" required />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="endsAt">
            Ends at (optional)
          </label>
          <Input id="endsAt" name="endsAt" type="datetime-local" />
        </div>
      </div>
      <Input name="location" placeholder="Location (optional)" maxLength={300} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" className="h-4 w-4" />
        Show on public site
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save event"}
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}
    </form>
  );
}
