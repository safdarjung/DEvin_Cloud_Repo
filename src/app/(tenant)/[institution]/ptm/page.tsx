import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { PtmSlotsManager } from "@/modules/ptm/components/PtmSlotsManager";
import { ptmEvents, ptmTeacherSchedule } from "@/modules/ptm/queries";

const eventDate = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export default async function PtmPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "ptm");
  requirePermission(ctx, "ptm.slot.manage");

  // Only published meetings accept bookings; RLS narrows ptm_slots to the caller's own for a teacher.
  const events = (await ptmEvents(ctx)).filter((e) => e.status === "published");
  const schedules = ctx.membership.staffId ? await Promise.all(events.map((e) => ptmTeacherSchedule(ctx, e.id))) : [];

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Parent-teacher meetings" description="Open time slots for parents to book with you." />
      {!ctx.membership.staffId ? (
        <EmptyState title="No staff profile on this account" description="Slots are tied to a staff profile. Ask an administrator to link yours." />
      ) : events.length === 0 ? (
        <EmptyState title="No published meetings" description="When the school publishes a parent-teacher meeting, you can open your slots here." />
      ) : (
        events.map((e, i) => (
          <Card key={e.id}>
            <CardHeader>
              <CardTitle>{e.title}</CardTitle>
              <CardDescription>
                {eventDate.format(new Date(`${e.eventDate}T00:00:00Z`))} · {e.dayStartsAt} to {e.dayEndsAt} · {e.slotMinutes} min slots ·{" "}
                {schedules[i].filter((s) => s.booking).length} booked
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PtmSlotsManager
                institutionSlug={slug}
                eventId={e.id}
                dayStartsAt={e.dayStartsAt}
                dayEndsAt={e.dayEndsAt}
                slots={schedules[i]}
              />
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
