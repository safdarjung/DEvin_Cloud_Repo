"use client";

import { Label } from "@/components/ui/label";
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
    <form action={formAction} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
      <h2 className="border-b-2 border-border pb-3 font-semibold">New event</h2>
      <div className="space-y-1">
        <Label htmlFor="eventTitle">Title</Label>
        <Input id="eventTitle" name="title" placeholder="Title" required maxLength={200} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="startsAt">
            Starts at
          </Label>
          <Input id="startsAt" name="startsAt" type="datetime-local" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="endsAt">
            Ends at (optional)
          </Label>
          <Input id="endsAt" name="endsAt" type="datetime-local" />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="eventLocation">Location (optional)</Label>
        <Input id="eventLocation" name="location" placeholder="Location (optional)" maxLength={300} />
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" className="size-4 accent-primary" />
        Show on public site
      </label>
      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}
      <div className="flex justify-end border-t border-border pt-3">
        <Button type="submit" className="w-full sm:w-auto" disabled={pending}>
          {pending ? "Saving…" : "Save event"}
        </Button>
      </div>
    </form>
  );
}
