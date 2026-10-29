import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
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
  requirePermission(ctx, "website.edit");

  const page = await getPageWithVersions(ctx, pageId);
  if (!page) notFound();

  const latest = page.versions[0];
  const latestBlocks = latest ? (await getVersion(ctx, pageId, latest.id))?.blocks ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{page.title}</h1>
        <p className="text-muted-foreground text-sm">/{page.slug}</p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Edit</h2>
        <BlockEditor institutionSlug={institutionSlug} pageId={page.id} initialBlocks={latestBlocks} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Preview (last saved version)</h2>
        <DraftPreview blocks={latestBlocks} slug={page.slug} institutionId={ctx.institution.id} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Versions</h2>
        <VersionList
          institutionSlug={institutionSlug}
          pageId={page.id}
          versions={page.versions}
          publishedVersionId={page.publishedVersionId}
          canPublish={hasPermission(ctx, "website.publish")}
        />
      </section>
    </div>
  );
}
