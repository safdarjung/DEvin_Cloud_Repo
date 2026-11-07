import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { BlockEditor } from "@/modules/website/components/BlockEditor";
import { DraftPreview } from "@/modules/website/components/DraftPreview";
import { VersionList } from "@/modules/website/components/VersionList";
import { getPageWithVersions, getVersion } from "@/modules/website/queries";

export default async function PageEditorPage({
  params,
}: {
  params: Promise<{ institution: string; pageId: string }>;
}) {
  const { institution: institutionSlug, pageId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "website");
  requirePermission(ctx, "website.edit");

  const page = await getPageWithVersions(ctx, pageId);
  if (!page) notFound();

  const latest = page.versions[0];
  const latestBlocks = latest ? (await getVersion(ctx, pageId, latest.id))?.blocks ?? [] : [];

  return (
    <div className="space-y-4">
      <PageHeader title={page.title} description={`/${page.slug}`} back={{ href: `/${institutionSlug}/website`, label: "Website" }} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Edit</CardTitle>
          </CardHeader>
          <CardContent>
            <BlockEditor institutionSlug={institutionSlug} pageId={page.id} initialBlocks={latestBlocks} />
          </CardContent>
        </Card>

        <Card className="min-w-0 self-start">
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
            <VersionList
            institutionSlug={institutionSlug}
            pageId={page.id}
            versions={page.versions}
            publishedVersionId={page.publishedVersionId}
            canPublish={hasPermission(ctx, "website.publish")}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Preview (last saved version)</CardTitle>
        </CardHeader>
        <CardContent>
          <DraftPreview blocks={latestBlocks} slug={page.slug} institutionId={ctx.institution.id} />
        </CardContent>
      </Card>
    </div>
  );
}
