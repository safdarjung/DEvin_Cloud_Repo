"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { actionErrorMessage } from "@/lib/actions/ui-error";
import { startThread } from "@/modules/messaging/actions";

const SELECT_CLASS = "h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-9";

/** Starts a thread (or appends to the existing one) and opens it. `threadBase` is the thread-list URL without query. */
export function NewThreadForm({
  institutionSlug,
  studentId,
  counterpartLabel,
  options,
  threadBase,
  threadQuery = "",
}: {
  institutionSlug: string;
  studentId: string;
  counterpartLabel: string;
  options: Array<{ id: string; label: string }>;
  threadBase: string;
  threadQuery?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [counterpartId, setCounterpartId] = useState(options[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const result = await startThread(institutionSlug, { studentId, counterpartId, subject, body });
      if (!result.ok) {
        toast.error(actionErrorMessage(result.error));
        return;
      }
      toast.success("Message sent.");
      router.push(`${threadBase}/${result.data.threadId}${threadQuery}`);
      router.refresh();
    });
  }

  if (options.length === 0) {
    return <p className="text-sm text-muted-foreground">No {counterpartLabel.toLowerCase()} is available to message for this student.</p>;
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor="nt-to">{counterpartLabel}</Label>
        <select id="nt-to" className={SELECT_CLASS} value={counterpartId} onChange={(e) => setCounterpartId(e.target.value)} disabled={pending}>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="nt-subject">Subject</Label>
        <Input id="nt-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} disabled={pending} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="nt-body">Message</Label>
        <Textarea id="nt-body" value={body} rows={4} maxLength={4000} onChange={(e) => setBody(e.target.value)} disabled={pending} required />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !subject.trim() || !body.trim()} className="min-h-11 w-full sm:min-h-10 sm:w-auto">
          {pending ? "Sending…" : "Send message"}
        </Button>
      </div>
    </form>
  );
}
