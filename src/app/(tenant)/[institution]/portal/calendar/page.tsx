import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { EmptyState, ErrorState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { CalendarList } from "@/modules/calendar/components/CalendarList";
import { calendarForRole } from "@/modules/calendar/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Calendar" };

// Read-only: RLS already limits portal users to audience "all" events.
export default async function PortalCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "calendar");
  requirePermission(ctx, "academics.read");

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${institutionSlug}/portal/calendar`, allParams);
  const events = await calendarForRole(ctx, {}).catch((err: unknown) => {
    console.error("portal calendar fetch failed:", err instanceof Error ? err.message : err);
    return null;
  });

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />
      <FadeIn key={selection.studentId} className="space-y-4">
        {!events ? (
          <ErrorState title="Could not load the calendar" description="Refresh to try again." />
        ) : events.length === 0 ? (
          <EmptyState title="Nothing scheduled" description="No holidays or events in the next 90 days." />
        ) : (
          <CalendarList events={events} />
        )}
      </FadeIn>
    </>
  );
}
