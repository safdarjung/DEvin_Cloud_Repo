import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { AnimatedList, BarList, type VizTone } from "@/components/widgets/viz";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { humanize, type BadgeVariant } from "@/lib/format";
import { todayInInstitutionTimezone } from "@/modules/attendance/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { CancelLeaveButton, LeaveRequestForm } from "@/modules/student-leave/components/LeaveControls";
import { studentLeaveRequests } from "@/modules/student-leave/queries";

export const metadata: Metadata = { title: "Leave" };

const date = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const fmt = (iso: string) => date.format(new Date(`${iso}T00:00:00Z`));
const STATUS_TONE: Record<string, VizTone> = { pending: "warning", approved: "success", rejected: "destructive" };
const STATUS_VARIANT: Record<string, BadgeVariant> = { pending: "warning", approved: "success", rejected: "destructive", cancelled: "secondary" };

export default async function PortalLeavePage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  if (ctx.membership.role !== "guardian") notFound();
  requirePermission(ctx, "student_leave.request");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/leave`, allParams);
  const rows = await studentLeaveRequests(ctx, { studentId: selection.studentId });
  const daysByStatus = new Map<string, number>();
  for (const r of rows) daysByStatus.set(r.status, (daysByStatus.get(r.status) ?? 0) + r.days);

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role="guardian" selection={selection} activeHref="/leave" />
      <FadeIn key={selection.studentId} className="grid gap-4 lg:grid-cols-2 *:min-w-0">
        <Card>
          <CardHeader>
            <CardTitle>Request leave for {selection.studentName}</CardTitle>
          </CardHeader>
          <CardContent>
            <LeaveRequestForm institutionSlug={institutionSlug} studentId={selection.studentId} today={todayInInstitutionTimezone(ctx)} />
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-3 text-base font-semibold">Leave history</h2>
          {rows.length === 0 ? (
            <EmptyState title="No leave requests yet" description="Use the form to send the first one." />
          ) : (
            <div className="space-y-3">
              <Card>
                <CardContent>
                  <BarList
                    ariaLabel="Leave days by status"
                    items={[...daysByStatus].map(([status, days]) => ({
                      label: humanize(status),
                      value: days,
                      display: `${days} day${days === 1 ? "" : "s"}`,
                      tone: STATUS_TONE[status],
                    }))}
                  />
                </CardContent>
              </Card>
            <AnimatedList ariaLabel="Leave history" className="grid gap-3 space-y-0">
              {rows.map((r) => (
                  <Card key={r.id}>
                    <CardContent className="grid gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-medium tabular-nums">
                          {fmt(r.startDate)}
                          {r.endDate !== r.startDate ? ` to ${fmt(r.endDate)}` : ""}
                          <span className="ml-2 font-normal text-muted-foreground">
                            {r.days} day{r.days === 1 ? "" : "s"}
                          </span>
                        </p>
                        <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{humanize(r.status)}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{r.reason}</p>
                      {r.decisionNote && <p className="text-sm">Teacher note: {r.decisionNote}</p>}
                      {r.status === "pending" && (
                        <div>
                          <CancelLeaveButton institutionSlug={institutionSlug} leaveId={r.id} />
                        </div>
                      )}
                    </CardContent>
                  </Card>
              ))}
            </AnimatedList>
            </div>
          )}
        </div>
      </FadeIn>
    </>
  );
}
