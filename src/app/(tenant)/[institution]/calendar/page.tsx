import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { DeleteEventButton, EventForm } from "@/modules/calendar/components/CalendarForms";
import { CalendarList } from "@/modules/calendar/components/CalendarList";
import { calendarForRole } from "@/modules/calendar/queries";
import { listAcademicYears } from "@/modules/finance/queries";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: slug } = await params;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "calendar");
  requirePermission(ctx, "academics.read");
  const canManage = hasPermission(ctx, "academics.manage");

  const [eventsR, yearsR] = await Promise.allSettled([calendarForRole(ctx, {}), canManage ? listAcademicYears(ctx) : Promise.resolve([])]);
  for (const r of [eventsR, yearsR]) if (r.status === "rejected") console.error("calendar page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const years = yearsR.status === "fulfilled" ? yearsR.value : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Calendar" description="Holidays, exam weeks and events for the next 90 days." />
      {eventsR.status === "rejected" ? (
        <ErrorState title="Could not load the calendar" description="Refresh to try again." />
      ) : eventsR.value.length === 0 ? (
        <EmptyState title="Nothing scheduled" description={canManage ? "Add the first event below." : "No holidays or events in the next 90 days."} />
      ) : (
        <CalendarList
          events={eventsR.value}
          actions={
            canManage
              ? (e) => (
                  <details className="text-sm">
                    <summary className="min-h-10 cursor-pointer py-2 text-muted-foreground">Edit or delete</summary>
                    <div className="space-y-3 pt-2">
                      <EventForm institutionSlug={slug} years={years} event={e} />
                      <DeleteEventButton institutionSlug={slug} event={e} />
                    </div>
                  </details>
                )
              : undefined
          }
        />
      )}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>New event</CardTitle>
          </CardHeader>
          <CardContent>
            {years.length === 0 ? <p className="text-sm text-muted-foreground">Create an academic year before adding events.</p> : <EventForm institutionSlug={slug} years={years} />}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
