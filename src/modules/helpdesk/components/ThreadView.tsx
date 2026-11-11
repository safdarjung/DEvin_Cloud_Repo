import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { humanize } from "@/lib/format";
import type { AssigneeOption, TicketThread } from "@/modules/helpdesk/queries";
import { ReplyForm, TicketControls } from "./HelpdeskForms";
import { MessageList, SlaBadge, StatusBadge, fmtDateTime } from "./TicketParts";

/** Thread + reply. Managers also get status/assignee controls; a raiser cannot reply once the ticket is closed. */
export function ThreadView({
  slug,
  thread,
  assignees,
  ai,
}: {
  slug: string;
  thread: TicketThread;
  assignees?: AssigneeOption[];
  ai?: { triage: boolean; translate: boolean };
}) {
  const t = thread.ticket;
  const staff = assignees !== undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.subject}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          <SlaBadge status={t.status} dueAt={t.dueAt} />
          <span>
            {humanize(t.category)} · {humanize(t.priority)} priority · Due <span className="tabular-nums">{fmtDateTime(t.dueAt)}</span>
            {staff && ` · Raised by ${t.raisedByName}`}
          </span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {staff && <TicketControls institutionSlug={slug} ticketId={t.id} status={t.status} assigneeStaffId={t.assigneeStaffId} assignees={assignees} />}
        <MessageList messages={thread.messages} />
        {!staff && t.status === "closed" ? (
          <p className="text-muted-foreground text-sm">This ticket is closed. Raise a new ticket if you still need help.</p>
        ) : (
          <ReplyForm institutionSlug={slug} ticketId={t.id} staff={staff} ai={ai} />
        )}
      </CardContent>
    </Card>
  );
}
