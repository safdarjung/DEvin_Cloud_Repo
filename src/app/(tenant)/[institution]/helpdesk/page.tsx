import Link from "next/link";
import { ListPager } from "@/components/list-pager";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppError } from "@/lib/actions/result";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { RaiseTicketForm } from "@/modules/helpdesk/components/HelpdeskForms";
import { SlaBadge, StatusBadge, fmtDateTime } from "@/modules/helpdesk/components/TicketParts";
import { ThreadView } from "@/modules/helpdesk/components/ThreadView";
import { getThread, listAssignees, listTickets, ticketCounts, HELPDESK_PAGE_SIZE } from "@/modules/helpdesk/queries";
import { HELPDESK_PRIORITIES, HELPDESK_STATUSES, TicketListSchema } from "@/modules/helpdesk/schemas";
import { aiTaskOn } from "@/modules/ai/task-route";
import { z } from "zod";

const SELECT_CLASS = "h-10 rounded-md border border-input bg-transparent px-3 text-sm";

// One route, two views: managers (helpdesk.manage) run the queue; a teacher holding only helpdesk.raise
// sees their own tickets and the raise form. RLS scopes the rows either way.
export default async function HelpdeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ status?: string; priority?: string; overdue?: string; page?: string; ticket?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "helpdesk");
  const manage = hasPermission(ctx, "helpdesk.manage");
  if (!manage && !hasPermission(ctx, "helpdesk.raise")) throw new AppError("forbidden", "You do not have access to the helpdesk.");

  const filters = TicketListSchema.safeParse({
    status: sp.status || undefined,
    priority: sp.priority || undefined,
    overdue: sp.overdue === "1" ? true : undefined,
    page: sp.page ? Number(sp.page) : undefined,
  });
  const input = filters.success ? filters.data : {};
  const ticketId = z.string().uuid().safeParse(sp.ticket);

  const [listR, countsR, threadR, assigneesR] = await Promise.allSettled([
    listTickets(ctx, input),
    manage ? ticketCounts(ctx) : Promise.resolve(null),
    ticketId.success ? getThread(ctx, ticketId.data) : Promise.resolve(null),
    manage ? listAssignees(ctx) : Promise.resolve([]),
  ]);
  for (const r of [listR, countsR, threadR, assigneesR]) if (r.status === "rejected") console.error("helpdesk page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const counts = countsR.status === "fulfilled" ? countsR.value : null;
  const thread = threadR.status === "fulfilled" ? threadR.value : null;
  const assignees = assigneesR.status === "fulfilled" ? assigneesR.value : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Helpdesk"
        description={manage ? "Tickets raised by guardians, students and teachers. Reply, assign and close them here." : "Your tickets to the school office, and a form to raise a new one."}
      />

      {counts && (
        <p className="text-sm tabular-nums" aria-label="Queue summary">
          {counts.open} open · {counts.overdue} overdue
        </p>
      )}

      {thread && (
        <section aria-label="Ticket">
          <Button asChild variant="outline" size="sm" className="mb-3">
            <Link href={`/${slug}/helpdesk`}>Back to list</Link>
          </Button>
          <ThreadView
            slug={slug}
            thread={thread}
            assignees={manage ? assignees : undefined}
            ai={{ triage: manage && aiTaskOn(ctx, "helpdesk_triage"), translate: aiTaskOn(ctx, "translate") }}
          />
        </section>
      )}

      <section aria-labelledby="hd-list" className="space-y-3">
        <h2 id="hd-list" className="text-base font-semibold">
          {manage ? "Queue" : "My tickets"}
        </h2>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block">Status</span>
            <select name="status" defaultValue={sp.status ?? ""} className={SELECT_CLASS}>
              <option value="">All</option>
              {HELPDESK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block">Priority</span>
            <select name="priority" defaultValue={sp.priority ?? ""} className={SELECT_CLASS}>
              <option value="">All</option>
              {HELPDESK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {humanize(p)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} />
            Overdue only
          </label>
          <Button type="submit" variant="outline">
            Filter
          </Button>
        </form>
        {listR.status === "rejected" ? (
          <ErrorState title="Could not load tickets" description="Refresh to try again." />
        ) : listR.value.rows.length === 0 ? (
          <EmptyState title="No tickets" description={manage ? "Nothing matches these filters." : "You have not raised any tickets yet."} />
        ) : (
          <Card>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Subject</TableHead>
                    {manage && <TableHead className="hidden sm:table-cell">Raised by</TableHead>}
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>SLA</TableHead>
                    {manage && <TableHead className="hidden md:table-cell">Assignee</TableHead>}
                    <TableHead className="hidden sm:table-cell">Raised</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {listR.value.rows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        <Link className="underline-offset-2 hover:underline" href={`/${slug}/helpdesk?ticket=${t.id}`}>
                          {t.subject}
                        </Link>
                      </TableCell>
                      {manage && <TableCell className="hidden sm:table-cell">{t.raisedByName}</TableCell>}
                      <TableCell>{humanize(t.priority)}</TableCell>
                      <TableCell>
                        <StatusBadge status={t.status} />
                      </TableCell>
                      <TableCell>
                        <SlaBadge status={t.status} dueAt={t.dueAt} />
                      </TableCell>
                      {manage && <TableCell className="hidden md:table-cell">{t.assigneeName ?? "Unassigned"}</TableCell>}
                      <TableCell className="hidden tabular-nums sm:table-cell">{fmtDateTime(t.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        {listR.status === "fulfilled" && (
          <ListPager
            basePath={`/${slug}/helpdesk`}
            params={{ status: sp.status, priority: sp.priority, overdue: sp.overdue }}
            page={listR.value.page}
            total={listR.value.total}
            pageSize={HELPDESK_PAGE_SIZE}
            noun="tickets"
          />
        )}
      </section>

      {!manage && (
        <Card>
          <CardHeader>
            <CardTitle>Raise a ticket</CardTitle>
          </CardHeader>
          <CardContent>
            <RaiseTicketForm institutionSlug={slug} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
