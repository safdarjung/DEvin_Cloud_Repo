import { redirect } from "next/navigation";
import { CircleAlert, CircleCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ListPager } from "@/components/list-pager";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProgressBar } from "@/components/widgets/viz";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { AcknowledgeButton, AutoRefresh, CloseAlertButton, HeadcountForm, SendAlertForm } from "@/modules/safety/components/SafetyForms";
import { formatAlertTime, KindBadge, SafetyAlertCard, SafetyDeliveryNote, SafetyDeliveryState, audienceText } from "@/modules/safety/components/SafetyAlertCard";
import {
  listSafetyAlerts,
  myHeadcountSections,
  safetyAlertDelivery,
  safetyAlertSummary,
  safetyPendingAcknowledgements,
  safetySectionOptions,
  type BoardRow,
  type SafetyAlertRow,
} from "@/modules/safety/queries";

const REFRESH_SECONDS = 20;
const GROUP_TEXT = { staff: "Staff", guardian: "Guardian", student: "Student" } as const;

// Staff view. Managers (safety.alert.send) send, watch acknowledgements and the
// headcount board, and close; teachers (safety.headcount.mark) acknowledge and
// report their own sections; other staff acknowledge. Students/guardians use the portal.
export default async function SafetyPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { institution: slug } = await params;
  const { page: pageParam } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "safety");
  requirePermission(ctx, "safety.alert.read");
  if (ctx.membership.role === "student" || ctx.membership.role === "guardian") redirect(`/${slug}/portal/safety`);

  const canSend = hasPermission(ctx, "safety.alert.send");
  const canMark = hasPermission(ctx, "safety.headcount.mark");
  const page = Math.max(1, Number(pageParam) || 1);

  const [listR, sectionsR] = await Promise.allSettled([listSafetyAlerts(ctx, page), canSend ? safetySectionOptions(ctx) : Promise.resolve([])]);
  for (const r of [listR, sectionsR]) if (r.status === "rejected") console.error("safety page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];
  const active = listR.status === "fulfilled" ? listR.value.active : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Safety alerts"
        description={
          canSend
            ? "Send emergency alerts, drills and closures, track who has seen them, and collect section headcounts."
            : "Acknowledge active alerts and report headcounts for your sections."
        }
      />

      {listR.status === "rejected" ? (
        <ErrorState title="Could not load safety alerts" description="Refresh to try again." />
      ) : (
        <>
          <section aria-labelledby="safety-active" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="safety-active" className="text-base font-semibold">
                Active alerts
              </h2>
              {active.length > 0 && <AutoRefresh seconds={REFRESH_SECONDS} />}
            </div>
            {active.length === 0 ? (
              <EmptyState title="No active alerts" description="When an alert is sent, it appears here for every staff member." />
            ) : (
              active.map((alert) => (
                <ActiveAlert key={alert.id} ctx={ctx} slug={slug} alert={alert} canSend={canSend} canMark={canMark} />
              ))
            )}
          </section>

          {canSend && (
            <section aria-labelledby="safety-send" className="space-y-3">
              <h2 id="safety-send" className="text-base font-semibold">
                Send an alert
              </h2>
              <Card>
                <CardHeader>
                  <CardTitle>New alert</CardTitle>
                  <CardDescription>You review the audience size before anything is sent.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <SafetyDeliveryNote />
                  <SendAlertForm institutionSlug={slug} sections={sections} />
                </CardContent>
              </Card>
            </section>
          )}

          <section aria-labelledby="safety-history" className="space-y-3">
            <h2 id="safety-history" className="text-base font-semibold">
              History
            </h2>
            {listR.value.history.length === 0 ? (
              <EmptyState title="No closed alerts yet" />
            ) : (
              <Card>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Alert</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead className="hidden sm:table-cell">Audience</TableHead>
                        <TableHead>Sent</TableHead>
                        <TableHead className="hidden sm:table-cell">Closed</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {listR.value.history.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell className="font-medium">{a.title}</TableCell>
                          <TableCell>
                            <KindBadge kind={a.kind} />
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">{audienceText(a)}</TableCell>
                          <TableCell className="tabular-nums">{formatAlertTime(a.createdAt)}</TableCell>
                          <TableCell className="hidden tabular-nums sm:table-cell">{a.closedAt ? formatAlertTime(a.closedAt) : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
            <ListPager basePath={`/${slug}/safety`} params={{}} page={listR.value.page} total={listR.value.historyTotal} pageSize={listR.value.pageSize} noun="closed alerts" />
          </section>
        </>
      )}
    </div>
  );
}

async function ActiveAlert({
  ctx,
  slug,
  alert,
  canSend,
  canMark,
}: {
  ctx: TenantContext;
  slug: string;
  alert: SafetyAlertRow;
  canSend: boolean;
  canMark: boolean;
}) {
  const [summaryR, pendingR, mineR, deliveryR] = await Promise.allSettled([
    canSend ? safetyAlertSummary(ctx, alert.id) : Promise.resolve(null),
    canSend ? safetyPendingAcknowledgements(ctx, alert.id) : Promise.resolve(null),
    canMark && !canSend ? myHeadcountSections(ctx, alert.id) : Promise.resolve([] as BoardRow[]),
    canSend ? safetyAlertDelivery(ctx, alert.id) : Promise.resolve(null),
  ]);
  for (const r of [summaryR, pendingR, mineR, deliveryR]) if (r.status === "rejected") console.error("safety alert detail failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const delivery = deliveryR.status === "fulfilled" ? deliveryR.value : null;
  const summary = summaryR.status === "fulfilled" ? summaryR.value : null;
  const pending = pendingR.status === "fulfilled" ? pendingR.value : null;
  const mine = mineR.status === "fulfilled" ? mineR.value : [];
  const boardSections = summary?.board.map((r) => ({ id: r.sectionId, label: r.label })) ?? [];

  return (
    <SafetyAlertCard alert={alert}>
      <div className="flex flex-wrap items-center gap-3">
        {alert.acknowledgedByMe ? (
          <Badge variant="success">
            <CircleCheck className="size-3.5" aria-hidden />
            You acknowledged this alert
          </Badge>
        ) : (
          <AcknowledgeButton institutionSlug={slug} alertId={alert.id} />
        )}
        {canSend && <CloseAlertButton institutionSlug={slug} alertId={alert.id} title={alert.title} />}
      </div>

      {canSend && <SafetyDeliveryNote />}

      {delivery && <SafetyDeliveryState delivery={delivery} />}

      {canSend && (summaryR.status === "rejected" || !summary) && <ErrorState title="Could not load acknowledgement counts" description="Use Refresh now to try again." />}

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2">
          <ProgressBar
            label="Acknowledged"
            value={summary.acknowledged.total}
            max={Math.max(1, summary.audience.total)}
            valueLabel={`${summary.acknowledged.total} of ${summary.audience.total}`}
          />
          <ProgressBar
            label="Sections reported"
            value={summary.headcount.reportedSections}
            max={Math.max(1, summary.headcount.totalSections)}
            valueLabel={`${summary.headcount.reportedSections} of ${summary.headcount.totalSections}`}
          />
          <p className="text-muted-foreground text-xs sm:col-span-2">
            Acknowledged: staff {summary.acknowledged.staff} of {summary.audience.staff} · guardians {summary.acknowledged.guardians} of {summary.audience.guardians} · students{" "}
            {summary.acknowledged.students} of {summary.audience.students}. Reported so far: {summary.headcount.present} present, {summary.headcount.missing} missing.
          </p>
        </div>
      )}

      {summary && <HeadcountBoard board={summary.board} />}

      {summary && boardSections.length > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Record a headcount for a section</summary>
          <div className="pt-3">
            <HeadcountForm institutionSlug={slug} alertId={alert.id} sections={boardSections} />
          </div>
        </details>
      )}

      {pending && pending.total > 0 && (
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">Not acknowledged yet ({pending.total})</summary>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {pending.shown.map((p, i) => (
              <li key={`${p.group}-${i}`}>
                {p.name} <span className="text-muted-foreground text-xs">({GROUP_TEXT[p.group]})</span>
              </li>
            ))}
          </ul>
          {pending.total > pending.shown.length && (
            <p className="text-muted-foreground mt-2 text-xs">Showing the first {pending.shown.length} of {pending.total}, staff first.</p>
          )}
        </details>
      )}

      {canMark && !canSend && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Headcount for your sections</h3>
          {mineR.status === "rejected" ? (
            <ErrorState title="Could not load your sections" description="Use Refresh now to try again." />
          ) : mine.length === 0 ? (
            <p className="text-muted-foreground text-sm">You are not the teacher of any section in this alert.</p>
          ) : (
            mine.map((row) => (
              <div key={row.sectionId} className="space-y-2 rounded-md border p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {row.label} <HeadcountStatus row={row} />
                </p>
                <HeadcountForm
                  institutionSlug={slug}
                  alertId={alert.id}
                  sections={[{ id: row.sectionId, label: row.label }]}
                  initial={row.headcount ?? undefined}
                />
              </div>
            ))
          )}
        </div>
      )}
    </SafetyAlertCard>
  );
}

function HeadcountStatus({ row }: { row: BoardRow }) {
  return row.headcount ? (
    <Badge variant="success">
      <CircleCheck className="size-3.5" aria-hidden />
      Reported {formatAlertTime(row.headcount.updatedAt)}
    </Badge>
  ) : (
    <Badge variant="warning">
      <CircleAlert className="size-3.5" aria-hidden />
      Not reported
    </Badge>
  );
}

function HeadcountBoard({ board }: { board: BoardRow[] }) {
  if (board.length === 0) return <p className="text-muted-foreground text-sm">No sections in the current academic year.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Section</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Present</TableHead>
          <TableHead className="text-right">Missing</TableHead>
          <TableHead className="hidden sm:table-cell">Note</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {board.map((row) => (
          <TableRow key={row.sectionId}>
            <TableCell className="font-medium">{row.label}</TableCell>
            <TableCell>
              <HeadcountStatus row={row} />
            </TableCell>
            <TableCell className="text-right tabular-nums">{row.headcount?.presentCount ?? "—"}</TableCell>
            <TableCell className="text-right tabular-nums">
              {row.headcount ? (
                row.headcount.missingCount > 0 ? (
                  <span className="text-destructive font-semibold">{row.headcount.missingCount} missing</span>
                ) : (
                  0
                )
              ) : (
                "—"
              )}
            </TableCell>
            <TableCell className="hidden sm:table-cell">{row.headcount?.note ?? ""}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
