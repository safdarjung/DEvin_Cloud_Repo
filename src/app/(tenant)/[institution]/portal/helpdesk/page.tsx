import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { ListPager } from "@/components/list-pager";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { RaiseTicketForm } from "@/modules/helpdesk/components/HelpdeskForms";
import { SlaBadge, StatusBadge, fmtDateTime } from "@/modules/helpdesk/components/TicketParts";
import { ThreadView } from "@/modules/helpdesk/components/ThreadView";
import { getThread, listTickets, HELPDESK_PAGE_SIZE } from "@/modules/helpdesk/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Helpdesk" };

// Guardian/student helpdesk: raise, list own, thread, reply while open. RLS scopes everything to the caller.
export default async function PortalHelpdeskPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string; ticket?: string; page?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "helpdesk");
  requirePermission(ctx, "helpdesk.raise");

  const selection = await resolvePortalSelection(ctx, sp.student, `/${slug}/portal/helpdesk`, sp);
  const ticketId = z.string().uuid().safeParse(sp.ticket);
  const [listR, threadR] = await Promise.allSettled([
    listTickets(ctx, { page: sp.page ? Math.max(1, Number(sp.page) || 1) : undefined }),
    ticketId.success ? getThread(ctx, ticketId.data) : Promise.resolve(null),
  ]);
  for (const r of [listR, threadR]) if (r.status === "rejected") console.error("portal helpdesk fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const thread = threadR.status === "fulfilled" ? threadR.value : null;

  return (
    <>
      <PortalNav institutionSlug={slug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />
      <div className="space-y-4">
        {thread && (
          <section aria-label="Ticket">
            <Button asChild variant="outline" size="sm" className="mb-3">
              <Link href={`/${slug}/portal/helpdesk`}>Back to my tickets</Link>
            </Button>
            <ThreadView slug={slug} thread={thread} />
          </section>
        )}
        <section aria-labelledby="ph-list" className="space-y-3">
          <h2 id="ph-list" className="text-base font-semibold">
            My tickets
          </h2>
          {listR.status === "rejected" ? (
            <ErrorState title="Could not load tickets" description="Refresh to try again." />
          ) : listR.value.rows.length === 0 ? (
            <EmptyState title="No tickets yet" description="Raise a ticket below and the school office will reply here." />
          ) : (
            <ul className="space-y-2">
              {listR.value.rows.map((t) => (
                <li key={t.id}>
                  <Card>
                    <CardContent className="flex flex-wrap items-start justify-between gap-3 pt-4">
                      <div className="min-w-0">
                        <Link className="font-medium underline-offset-2 hover:underline" href={`/${slug}/portal/helpdesk?student=${selection.studentId}&ticket=${t.id}`}>
                          {t.subject}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          {humanize(t.category)} · {humanize(t.priority)} priority · Raised <span className="tabular-nums">{fmtDateTime(t.createdAt)}</span>
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <StatusBadge status={t.status} />
                        <SlaBadge status={t.status} dueAt={t.dueAt} />
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
          {listR.status === "fulfilled" && (
            <ListPager basePath={`/${slug}/portal/helpdesk`} params={{}} page={listR.value.page} total={listR.value.total} pageSize={HELPDESK_PAGE_SIZE} noun="tickets" />
          )}
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Raise a ticket</CardTitle>
          </CardHeader>
          <CardContent>
            <RaiseTicketForm institutionSlug={slug} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
