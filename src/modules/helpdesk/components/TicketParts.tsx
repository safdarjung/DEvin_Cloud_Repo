import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/format";
import { slaState, type SlaState } from "@/modules/helpdesk/schemas";
import type { TicketMessage } from "@/modules/helpdesk/queries";

const dateTimeFmt = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const fmtDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

const SLA: Record<SlaState, { label: string; variant: "success" | "warning" | "destructive" | "outline" }> = {
  on_time: { label: "On time", variant: "success" },
  due_soon: { label: "Due soon", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  done: { label: "Done", variant: "outline" },
};

/** SLA state is always spelled out in text, never colour alone. */
export function SlaBadge({ status, dueAt }: { status: string; dueAt: string }) {
  const s = SLA[slaState(status, dueAt)];
  return (
    <Badge variant={s.variant}>
      {s.label}
      <span className="sr-only">, due {fmtDateTime(dueAt)}</span>
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "open" ? "info" : status === "in_progress" ? "warning" : "outline"}>{humanize(status)}</Badge>;
}

export function MessageList({ messages }: { messages: TicketMessage[] }) {
  return (
    <ol className="space-y-2" aria-label="Conversation">
      {messages.map((m) => (
        <li key={m.id} className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">
            {m.mine ? "You" : m.authorName} · <span className="tabular-nums">{fmtDateTime(m.createdAt)}</span>
          </p>
          <p className="mt-1 text-sm whitespace-pre-wrap">{m.body}</p>
        </li>
      ))}
    </ol>
  );
}
