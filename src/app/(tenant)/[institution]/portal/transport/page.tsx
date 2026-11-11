import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { transportForStudent } from "@/modules/transport/queries";

export const metadata: Metadata = { title: "Transport" };

// Guardian (own children) / student (self): route, stop and pickup time. RLS scopes the assignment.
export default async function PortalTransportPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "transport");
  requirePermission(ctx, "student.read");

  const selection = await resolvePortalSelection(ctx, allParams.student, `/${institutionSlug}/portal/transport`, allParams);
  const result = await transportForStudent(ctx, selection.studentId).then(
    (t) => ({ t }),
    (err: unknown) => {
      console.error("portal transport fetch failed:", err instanceof Error ? err.message : err);
      return null;
    },
  );
  const t = result?.t ?? null;

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />
      <FadeIn key={selection.studentId} className="space-y-4">
        {!result ? (
          <ErrorState title="Could not load transport" description="Refresh to try again." />
        ) : !t ? (
          <EmptyState title="No school transport" description={`${selection.studentName} is not assigned to a bus route. Ask the school office to arrange one.`} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {t.routeName}
                <Badge variant={t.status === "on_time" ? "success" : t.status === "delayed" ? "warning" : "outline"}>{humanize(t.status)}</Badge>
              </CardTitle>
              <CardDescription>{selection.studentName}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                Pickup stop: <span className="font-medium">{t.stop.name}</span> at <span className="font-medium tabular-nums">{t.stop.eta}</span>
              </p>
              {t.vehicle && (
                <p className="text-muted-foreground">
                  Vehicle {t.vehicle}
                  {t.driver ? ` · Driver ${t.driver}` : ""}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </FadeIn>
    </>
  );
}
