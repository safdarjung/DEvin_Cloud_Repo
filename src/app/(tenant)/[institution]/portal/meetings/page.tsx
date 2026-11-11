import type { Metadata } from "next";
import { Stagger, StaggerItem } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { ProgressBar } from "@/components/widgets/viz";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, hasPermission } from "@/lib/auth/require";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { ptmForStudent, type PtmBookableRow } from "@/modules/ptm/queries";
import { PtmSlotButton } from "@/modules/ptm/components/PtmSlotButton";

export const metadata: Metadata = { title: "Meetings" };

export default async function PortalMeetingsPage({
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
  requirePermission(ctx, "ptm.book");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/meetings`, allParams);
  const rows = await ptmForStudent(ctx, selection.studentId);

  const events = new Map<string, { title: string; date: string; closes: string; rows: PtmBookableRow[] }>();
  for (const r of rows) {
    const e = events.get(r.eventId) ?? { title: r.eventTitle, date: r.eventDate, closes: r.bookingClosesAt, rows: [] };
    e.rows.push(r);
    events.set(r.eventId, e);
  }

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/meetings"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      {events.size === 0 ? (
        <EmptyState title="No parent-teacher meetings are open for booking." />
      ) : (
        <Stagger key={selection.studentId} className="space-y-4">
          {[...events.entries()].map(([id, e]) => {
            const byTeacher = new Map<string, PtmBookableRow[]>();
            for (const r of e.rows) byTeacher.set(r.staffId, [...(byTeacher.get(r.staffId) ?? []), r]);
            const open = e.rows.filter((r) => r.state !== "taken").length;
            return (
              <StaggerItem key={id}>
              <Card>
                <CardHeader>
                  <CardTitle>{e.title}</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {e.date} · booking closes {new Date(e.closes).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </p>
                  <ProgressBar
                    className="pt-2"
                    label="Slots still open"
                    value={open}
                    max={e.rows.length}
                    valueLabel={`${open} of ${e.rows.length}`}
                  />
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2 *:min-w-0">
                  {[...byTeacher.values()].map((slots) => (
                    <div key={slots[0].staffId}>
                      <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                        {slots[0].teacherName}
                        {slots[0].isClassTeacher && <Badge variant="info">Class teacher</Badge>}
                        {slots[0].subjects.length > 0 && (
                          <span className="text-xs font-normal text-muted-foreground">{slots[0].subjects.join(", ")}</span>
                        )}
                      </h3>
                      <ul className="mt-1 divide-y divide-border">
                        {slots.map((s) => (
                          <li key={s.slotId} className="flex min-h-11 items-center justify-between gap-3 py-1.5 text-sm">
                            <span className="tabular-nums">
                              {s.startsAt}–{s.endsAt}
                            </span>
                            {s.state === "taken" ? (
                              <Badge variant="secondary">Taken</Badge>
                            ) : (
                              <PtmSlotButton
                                institutionSlug={institutionSlug}
                                studentId={selection.studentId}
                                slotId={s.slotId}
                                bookingId={s.state === "mine" ? s.bookingId : null}
                              />
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </CardContent>
              </Card>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </>
  );
}
