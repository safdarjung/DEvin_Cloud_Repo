import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { humanize } from "@/lib/format";
import { portalTimeline } from "@/modules/behaviour/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

// Read-only. RLS already hides voided rows from guardian/student; the query filters again.
export default async function PortalBehaviourPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: slug } = await params;
  const allParams = await searchParams;
  const { student } = allParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "behaviour");
  requirePermission(ctx, "behaviour.read");

  const selection = await resolvePortalSelection(ctx, student, `/${slug}/portal/behaviour`, allParams);
  const { incidents, total } = await portalTimeline(ctx, selection.studentId);

  return (
    <>
      <PortalNav institutionSlug={slug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Behaviour points: {selection.studentName}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums" aria-label={`Total points ${total}`}>
              {total > 0 ? `+${total}` : total}
            </p>
            <p className="text-muted-foreground text-xs">Merit points add, demerit points subtract.</p>
          </CardContent>
        </Card>
        {incidents.length === 0 ? (
          <EmptyState title="No behaviour records." />
        ) : (
          <ol className="space-y-2">
            {incidents.map((i) => (
              <li key={i.id}>
                <Card>
                  <CardContent className="flex items-start justify-between gap-3 pt-4">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {i.category} <Badge variant="outline">{humanize(i.severity)}</Badge>
                      </p>
                      <p className="text-muted-foreground text-xs tabular-nums">{i.occurredOn}</p>
                      {i.note && <p className="mt-1 text-sm">{i.note}</p>}
                    </div>
                    <span className="font-semibold tabular-nums">{i.points > 0 ? `+${i.points}` : i.points}</span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
