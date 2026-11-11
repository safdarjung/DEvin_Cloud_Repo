import { EmptyState, ErrorState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";
import { ResourceBody } from "@/modules/resources/components/ResourceCard";
import { portalResources, type ResourceRow } from "@/modules/resources/queries";

// Read-only. RLS limits rows to published resources for the caller's own sections; the query narrows
// to the selected child. Files download only through the documents module's signed read URL.
export default async function PortalResourcesPage({
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
  requireModule(ctx, "resources");
  requirePermission(ctx, "resource.read");

  const selection = await resolvePortalSelection(ctx, student, `/${slug}/portal/resources`, allParams);
  const nav = <PortalNav institutionSlug={slug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />;

  let rows: ResourceRow[];
  try {
    rows = await portalResources(ctx, selection.studentId);
  } catch (e) {
    console.error("portal resources fetch failed:", e instanceof Error ? e.message : e);
    return (
      <>
        {nav}
        <ErrorState title="Could not load resources" description="Refresh to try again." />
      </>
    );
  }

  const bySubject = new Map<string, ResourceRow[]>();
  for (const r of rows) bySubject.set(r.subjectName, [...(bySubject.get(r.subjectName) ?? []), r]);

  return (
    <>
      {nav}
      {rows.length === 0 ? (
        <EmptyState title="No resources yet" description={`Learning resources shared with ${selection.studentName}'s class appear here.`} />
      ) : (
        <div className="space-y-5">
          {[...bySubject].sort(([a], [b]) => a.localeCompare(b)).map(([subject, items]) => (
            <section key={subject} aria-label={subject} className="space-y-2">
              <h2 className="text-base font-semibold">{subject}</h2>
              <ul className="space-y-2">
                {items.map((r) => (
                  <li key={r.id}>
                    <Card>
                      <CardContent className="pt-4">
                        <ResourceBody resource={r} institutionSlug={slug} />
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
