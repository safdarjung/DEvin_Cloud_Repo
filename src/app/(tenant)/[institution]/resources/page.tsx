import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requireModule, requirePermission } from "@/lib/auth/require";
import { listSubjectOptions } from "@/modules/exams/queries";
import { ResourceBody } from "@/modules/resources/components/ResourceCard";
import { CreateResourceForm, ResourceRowActions } from "@/modules/resources/components/ResourceForms";
import { browseResources, listAudienceSections, listMyResources, listUnitOptions, type ResourceRow } from "@/modules/resources/queries";
import { ResourceBrowseSchema } from "@/modules/resources/schemas";

export const metadata: Metadata = { title: "Resources" };

const SELECT_CLASS = "h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm";

function groupBySubject(rows: ResourceRow[]): [string, ResourceRow[]][] {
  const map = new Map<string, ResourceRow[]>();
  for (const r of rows) map.set(r.subjectName, [...(map.get(r.subjectName) ?? []), r]);
  return [...map].sort(([a], [b]) => a.localeCompare(b));
}

export default async function ResourcesPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ subject?: string }>;
}) {
  const { institution: slug } = await params;
  const sp = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "resources");
  requirePermission(ctx, "resource.read");
  const canManage = hasPermission(ctx, "resource.manage");

  // Invalid filter falls back to "all subjects" rather than 500.
  const parsed = ResourceBrowseSchema.safeParse({ subjectId: sp.subject || undefined });
  const filters = parsed.success ? parsed.data : {};

  const [browseR, mineR, subjectsR, unitsR, sectionsR] = await Promise.allSettled([
    browseResources(ctx, filters),
    canManage ? listMyResources(ctx) : Promise.resolve([]),
    listSubjectOptions(ctx),
    canManage ? listUnitOptions(ctx) : Promise.resolve([]),
    canManage ? listAudienceSections(ctx) : Promise.resolve([]),
  ]);
  for (const r of [browseR, mineR, subjectsR, unitsR, sectionsR]) if (r.status === "rejected") console.error("resources page fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
  const subjects = subjectsR.status === "fulfilled" ? subjectsR.value : [];
  const units = unitsR.status === "fulfilled" ? unitsR.value : [];
  const sections = sectionsR.status === "fulfilled" ? sectionsR.value : [];
  const sectionLabel = new Map(sections.map((s) => [s.id, s.label]));
  const mine = mineR.status === "fulfilled" ? mineR.value : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Resources"
        description={canManage ? "Share links, videos, notes and files with the sections you teach. Drafts stay hidden until you publish." : "Learning resources shared by teachers."}
      />

      {canManage && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Add a resource</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateResourceForm institutionSlug={slug} subjects={subjects.map((s) => ({ id: s.id, label: s.name }))} units={units} sections={sections} />
            </CardContent>
          </Card>

          <section aria-labelledby="rs-mine" className="space-y-3">
            <h2 id="rs-mine" className="text-base font-semibold">
              My resources
            </h2>
            {mineR.status === "rejected" ? (
              <ErrorState title="Could not load your resources" description="Refresh to try again." />
            ) : mine.length === 0 ? (
              <EmptyState title="Nothing added yet" description="Resources you add appear here, with publish controls." />
            ) : (
              <ul className="space-y-2">
                {mine.map((r) => (
                  <li key={r.id}>
                    <Card>
                      <CardContent className="space-y-2 pt-4">
                        <ResourceBody resource={r} institutionSlug={slug}>
                          <Badge variant={r.published ? "success" : "outline"}>{r.published ? "Published" : "Draft"}</Badge>
                        </ResourceBody>
                        <p className="text-muted-foreground text-xs">
                          {r.subjectName}. Sections: {r.sectionIds.length === 0 ? "none (staff only)" : r.sectionIds.map((id) => sectionLabel.get(id) ?? "Section").join(", ")}
                        </p>
                        <ResourceRowActions institutionSlug={slug} resourceId={r.id} kind={r.kind} published={r.published} hasFile={r.documentId !== null} />
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section aria-labelledby="rs-browse" className="space-y-3">
        <h2 id="rs-browse" className="text-base font-semibold">
          Browse by subject
        </h2>
        <form method="get" className="flex items-end gap-2">
          <div className="w-64">
            <Label htmlFor="rs-filter">Subject</Label>
            <select id="rs-filter" name="subject" defaultValue={sp.subject ?? ""} className={SELECT_CLASS}>
              <option value="">All subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit">Filter</Button>
          <Button asChild variant="ghost">
            <Link href={`/${slug}/resources`}>Clear</Link>
          </Button>
        </form>
        {browseR.status === "rejected" ? (
          <ErrorState title="Could not load resources" description="Refresh to try again." />
        ) : browseR.value.length === 0 ? (
          <EmptyState title="No resources" description="Published resources appear here." />
        ) : (
          groupBySubject(browseR.value).map(([subject, rows]) => (
            <div key={subject} className="space-y-2">
              <h3 className="text-sm font-semibold">{subject}</h3>
              <ul className="space-y-2">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Card>
                      <CardContent className="pt-4">
                        <ResourceBody resource={r} institutionSlug={slug}>
                          {!r.published && <Badge variant="outline">Draft</Badge>}
                        </ResourceBody>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
