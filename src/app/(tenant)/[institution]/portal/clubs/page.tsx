import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FadeIn } from "@/components/motion";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { MembershipButton, SignupButton } from "@/modules/clubs/components/PortalControls";
import { clubEventsList, clubsList, currentTimeMs, myClubState } from "@/modules/clubs/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Clubs" };

const when = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default async function PortalClubsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: slug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(slug);
  if (ctx.membership.role !== "guardian" && ctx.membership.role !== "student") notFound();
  requireModule(ctx, "clubs");
  requirePermission(ctx, "club.join");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${slug}/portal/clubs`, allParams);
  const [clubsR, eventsR, stateR] = await Promise.allSettled([clubsList(ctx), clubEventsList(ctx), myClubState(ctx, selection.studentId)]);
  const role = ctx.membership.role as "guardian" | "student";
  if (clubsR.status === "rejected" || eventsR.status === "rejected" || stateR.status === "rejected") {
    return (
      <>
        <PortalNav institutionSlug={slug} role={role} selection={selection} />
        <ErrorState title="Could not load clubs" description="Refresh to try again." />
      </>
    );
  }
  const state = stateR.value;
  const clubs = clubsR.value.filter((c) => c.isActive || state.clubIds.includes(c.id));
  const now = currentTimeMs();
  const events = eventsR.value.filter((e) => e.status === "scheduled" && new Date(e.startsAt).getTime() > now).reverse();

  return (
    <>
      <PortalNav institutionSlug={slug} role={role} selection={selection} />
      <FadeIn key={selection.studentId} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>House</CardTitle>
          </CardHeader>
          <CardContent>
            {state.house ? (
              <p className="flex items-center gap-2 text-sm">
                <span aria-hidden className="inline-block size-3 rounded-full" style={{ backgroundColor: state.house.colour ?? "var(--primary)" }} />
                {selection.studentName} is in <strong>{state.house.name}</strong> house.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No house assigned yet.</p>
            )}
          </CardContent>
        </Card>

        <section aria-labelledby="pc-clubs" className="space-y-3">
          <h2 id="pc-clubs" className="text-base font-semibold">
            Clubs
          </h2>
          {clubs.length === 0 ? (
            <EmptyState title="No clubs yet" description="The school has not opened any clubs." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 *:min-w-0">
              {clubs.map((c) => {
                const isMember = state.clubIds.includes(c.id);
                return (
                  <Card key={c.id}>
                    <CardContent className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{c.name}</p>
                        {isMember && <Badge variant="success">Member</Badge>}
                      </div>
                      {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                      <p className="text-xs text-muted-foreground">
                        {c.patronName ? `Patron: ${c.patronName}` : "No patron yet"}
                        {c.capacity ? ` · Capacity ${c.capacity}` : ""}
                      </p>
                      {(c.isActive || isMember) && (
                        <MembershipButton institutionSlug={slug} clubId={c.id} studentId={selection.studentId} isMember={isMember} name={c.name} />
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="pc-events" className="space-y-3">
          <h2 id="pc-events" className="text-base font-semibold">
            Upcoming events
          </h2>
          {events.length === 0 ? (
            <EmptyState title="No upcoming events" description="Club events will show here when they are scheduled." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 *:min-w-0">
              {events.map((e) => {
                const signedUp = state.signedUpEventIds.includes(e.id);
                const closed = e.signupClosesAt ? new Date(e.signupClosesAt).getTime() < now : false;
                return (
                  <Card key={e.id}>
                    <CardContent className="space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-medium">{e.title}</p>
                        {signedUp && <Badge variant="success">Signed up</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {e.clubName} · {when.format(new Date(e.startsAt))}
                        {e.venue ? ` · ${e.venue}` : ""}
                      </p>
                      {e.description && <p className="text-sm">{e.description}</p>}
                      {closed && !signedUp ? <Badge variant="outline">{humanize("sign-up closed")}</Badge> : <SignupButton institutionSlug={slug} eventId={e.id} studentId={selection.studentId} signedUp={signedUp} title={e.title} />}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      </FadeIn>
    </>
  );
}
