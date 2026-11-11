"use client";

import { Label } from "@/components/ui/label";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/actions/result";
import { upsertNotice } from "@/modules/website/actions";
import { TranslateButton } from "@/modules/ai/components/TranslateButton";

interface NoticeFormProps {
  institutionSlug: string;
  /** Shows the AI translate control only; the route re-checks. */
  canTranslate?: boolean;
}

// shortcut: no edit-existing-notice flow here — the packet's acceptance
// criteria only need notices created and shown publicly per is_public/dates
// (criterion 5); upgrade to an edit form once a packet needs it.
export function NoticeForm({ institutionSlug, canTranslate = false }: NoticeFormProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult<{ id: string }> | null, FormData>(
    async (_prev, formData) => {
      const publishAtLocal = String(formData.get("publishAt") ?? "");
      const expiresAtLocal = String(formData.get("expiresAt") ?? "");
      const result = await upsertNotice(institutionSlug, {
        title: String(formData.get("title") ?? "").trim(),
        body: String(formData.get("body") ?? "").trim(),
        publishAt: publishAtLocal ? new Date(publishAtLocal).toISOString() : new Date().toISOString(),
        expiresAt: expiresAtLocal ? new Date(expiresAtLocal).toISOString() : undefined,
        isPublic: formData.get("isPublic") === "on",
      });
      if (result.ok) setBody(""); // body is controlled now, so the form reset no longer clears it
      return result;
    },
    null,
  );

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  return (
    <form action={formAction} className="min-w-0 space-y-3 rounded-lg border bg-card p-4">
      <h2 className="border-b-2 border-border pb-3 font-semibold">New notice</h2>
      <div className="space-y-1">
        <Label htmlFor="noticeTitle">Title</Label>
        <Input id="noticeTitle" name="title" placeholder="Title" required maxLength={200} />
      </div>
      <div className="space-y-1">
      <Label htmlFor="noticeBody">Body</Label>
      <Textarea
        id="noticeBody"
        name="body"
        placeholder="Body"
        required
        maxLength={5000}
        className="min-h-24"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {canTranslate && <TranslateButton institutionSlug={institutionSlug} text={body} onUse={setBody} />}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="publishAt">
            Publish at
          </Label>
          <Input id="publishAt" name="publishAt" type="datetime-local" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="expiresAt">
            Expires at (optional)
          </Label>
          <Input id="expiresAt" name="expiresAt" type="datetime-local" />
        </div>
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
          {pending ? "Saving…" : "Save notice"}
        </Button>
      </div>
    </form>
  );
}
