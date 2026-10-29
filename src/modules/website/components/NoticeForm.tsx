"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/actions/result";
import { upsertNotice } from "@/modules/website/actions";

interface NoticeFormProps {
  institutionSlug: string;
}

// shortcut: no edit-existing-notice flow here — the packet's acceptance
// criteria only need notices created and shown publicly per is_public/dates
// (criterion 5); upgrade to an edit form once a packet needs it.
export function NoticeForm({ institutionSlug }: NoticeFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prev, formData) => {
      const publishAtLocal = String(formData.get("publishAt") ?? "");
      const expiresAtLocal = String(formData.get("expiresAt") ?? "");
      return upsertNotice(institutionSlug, {
        title: String(formData.get("title") ?? "").trim(),
        body: String(formData.get("body") ?? "").trim(),
        publishAt: publishAtLocal ? new Date(publishAtLocal).toISOString() : new Date().toISOString(),
        expiresAt: expiresAtLocal ? new Date(expiresAtLocal).toISOString() : undefined,
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
      <h2 className="text-sm font-medium">New notice</h2>
      <Input name="title" placeholder="Title" required maxLength={200} />
      <textarea
        name="body"
        placeholder="Body"
        required
        maxLength={5000}
        className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-sm font-medium" htmlFor="publishAt">
            Publish at
          </label>
          <Input id="publishAt" name="publishAt" type="datetime-local" />
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="expiresAt">
            Expires at (optional)
          </label>
          <Input id="expiresAt" name="expiresAt" type="datetime-local" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isPublic" className="h-4 w-4" />
        Show on public site
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save notice"}
      </Button>
      {state && !state.ok && (
        <p role="alert" className="text-destructive text-sm">
          {state.error.message}
        </p>
      )}
    </form>
  );
}
