"use client";

// Hiding these is UX only: actions re-check the permission, Zod and RLS.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeActionError } from "@/lib/action-error";
import { humanize } from "@/lib/format";
import { addTicketMessage, raiseTicket, replyToTicket, updateTicket } from "@/modules/helpdesk/actions";
import { HELPDESK_CATEGORIES, HELPDESK_PRIORITIES, HELPDESK_STATUSES, RaiseTicketSchema, TicketMessageSchema } from "@/modules/helpdesk/schemas";
import { HelpdeskTriagePanel } from "@/modules/ai/components/HelpdeskTriagePanel";
import { TranslateButton } from "@/modules/ai/components/TranslateButton";

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";
const AREA_CLASS = "min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm";

export function RaiseTicketForm({ institutionSlug }: { institutionSlug: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const parsed = RaiseTicketSchema.safeParse({
      category: fd.get("category"),
      priority: fd.get("priority"),
      subject: fd.get("subject"),
      body: fd.get("body"),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError(null);
    start(async () => {
      const res = await raiseTicket(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Ticket raised");
        form.reset();
        router.refresh();
      } else {
        setError(describeActionError(res.error));
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
      <div>
        <Label htmlFor="hd-category">Category</Label>
        <select id="hd-category" name="category" className={SELECT_CLASS} defaultValue="other">
          {HELPDESK_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {humanize(c)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor="hd-priority">Priority</Label>
        <select id="hd-priority" name="priority" className={SELECT_CLASS} defaultValue="normal">
          {HELPDESK_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {humanize(p)}
            </option>
          ))}
        </select>
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="hd-subject">Subject</Label>
        <Input id="hd-subject" name="subject" required maxLength={200} />
      </div>
      <div className="sm:col-span-2">
        <Label htmlFor="hd-body">Describe the problem</Label>
        <textarea id="hd-body" name="body" required maxLength={4000} className={AREA_CLASS} />
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm sm:col-span-2">
          {error}
        </p>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending..." : "Raise ticket"}
        </Button>
      </div>
    </form>
  );
}

/** Reply box. `staff` picks the manager action; a raiser reply is refused by RLS once the ticket is closed. `ai` flags only show controls; the AI routes re-check. */
export function ReplyForm({
  institutionSlug,
  ticketId,
  staff,
  ai,
}: {
  institutionSlug: string;
  ticketId: string;
  staff: boolean;
  ai?: { triage: boolean; translate: boolean };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [aiDraft, setAiDraft] = useState(false);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const parsed = TicketMessageSchema.safeParse({ ticketId, body });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    setError(null);
    start(async () => {
      const res = await (staff ? replyToTicket : addTicketMessage)(institutionSlug, parsed.data);
      if (res.ok) {
        toast.success("Reply sent");
        setBody("");
        setAiDraft(false);
        router.refresh();
      } else {
        setError(describeActionError(res.error));
      }
    });
  }

  const fill = (text: string) => {
    setBody(text);
    setAiDraft(true);
  };

  return (
    <form onSubmit={submit} className="space-y-2" aria-busy={pending}>
      {ai?.triage && <HelpdeskTriagePanel institutionSlug={institutionSlug} ticketId={ticketId} onDraft={fill} />}
      <Label htmlFor="hd-reply">Reply</Label>
      {aiDraft && <p className="text-muted-foreground text-xs">AI draft — edit before sending.</p>}
      <textarea id="hd-reply" name="body" required maxLength={4000} className={AREA_CLASS} value={body} onChange={(e) => setBody(e.target.value)} />
      {ai?.translate && <TranslateButton institutionSlug={institutionSlug} text={body} onUse={fill} />}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send reply"}
      </Button>
    </form>
  );
}

/** Status + assignee. The definer sets both, so each change re-sends the current value of the other. */
export function TicketControls({
  institutionSlug,
  ticketId,
  status,
  assigneeStaffId,
  assignees,
}: {
  institutionSlug: string;
  ticketId: string;
  status: string;
  assigneeStaffId: string | null;
  assignees: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function change(next: { status: string; assigneeStaffId: string | null }) {
    start(async () => {
      const res = await updateTicket(institutionSlug, { ticketId, ...next } as never);
      if (res.ok) {
        toast.success("Ticket updated");
        router.refresh();
      } else {
        toast.error(describeActionError(res.error));
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-3" aria-busy={pending}>
      <div>
        <Label htmlFor={`hd-status-${ticketId}`}>Status</Label>
        <select
          id={`hd-status-${ticketId}`}
          className={SELECT_CLASS}
          value={status}
          disabled={pending}
          onChange={(e) => change({ status: e.target.value, assigneeStaffId })}
        >
          {HELPDESK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {humanize(s)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <Label htmlFor={`hd-assignee-${ticketId}`}>Assignee</Label>
        <select
          id={`hd-assignee-${ticketId}`}
          className={SELECT_CLASS}
          value={assigneeStaffId ?? ""}
          disabled={pending}
          onChange={(e) => change({ status, assigneeStaffId: e.target.value || null })}
        >
          <option value="">Unassigned</option>
          {assignees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
