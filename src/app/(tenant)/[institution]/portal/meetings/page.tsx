import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { ptmForStudent, type PtmBookableRow } from "@/modules/ptm/queries";
import { PtmSlotButton } from "@/modules/ptm/components/PtmSlotButton";

export default async function PortalMeetingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "ptm.book");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/meetings`);
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
      />
      {events.size === 0 ? (
        <p className="text-sm text-muted-foreground">No parent-teacher meetings are open for booking.</p>
      ) : (
        <div className="space-y-4">
          {[...events.entries()].map(([id, e]) => {
            const byTeacher = new Map<string, PtmBookableRow[]>();
            for (const r of e.rows) byTeacher.set(r.staffId, [...(byTeacher.get(r.staffId) ?? []), r]);
            return (
              <Card key={id}>
                <CardHeader>
                  <CardTitle>{e.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {e.date} · booking closes {new Date(e.closes).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[...byTeacher.values()].map((slots) => (
                    <div key={slots[0].staffId}>
                      <h3 className="text-sm font-medium">
                        {slots[0].teacherName}
                        {slots[0].isClassTeacher && <span className="ml-2 text-xs text-muted-foreground">Class teacher</span>}
                        {slots[0].subjects.length > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground">{slots[0].subjects.join(", ")}</span>
                        )}
                      </h3>
                      <ul className="divide-y divide-border">
                        {slots.map((s) => (
                          <li key={s.slotId} className="flex items-center justify-between gap-3 py-2 text-sm">
                            <span className="tabular-nums">
                              {s.startsAt}–{s.endsAt}
                            </span>
                            {s.state === "taken" ? (
                              <span className="text-muted-foreground">Taken</span>
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
            );
          })}
        </div>
      )}
    </>
  );
}
