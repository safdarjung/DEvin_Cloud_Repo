"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { markThreadRead, sendMessage } from "@/modules/messaging/actions";

/** Reply box. Also marks the thread read on open (participants only; `markRead`). */
export function ReplyComposer({
  institutionSlug,
  threadId,
  markRead,
}: {
  institutionSlug: string;
  threadId: string;
  markRead: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");

  useEffect(() => {
    if (!markRead) return;
    let cancelled = false;
    void markThreadRead(institutionSlug, { threadId }).then((r) => {
      if (!cancelled && r.ok && r.data.marked > 0) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [institutionSlug, threadId, markRead, router]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await sendMessage(institutionSlug, { threadId, body });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <Textarea aria-label="Reply" value={body} rows={3} maxLength={4000} onChange={(e) => setBody(e.target.value)} disabled={pending} placeholder="Write a reply" />
      <Button type="submit" disabled={pending || !body.trim()} className="min-h-10">
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}
