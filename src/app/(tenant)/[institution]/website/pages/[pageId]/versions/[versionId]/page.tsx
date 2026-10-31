import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { DraftPreview } from "@/modules/website/components/DraftPreview";
import { getPageWithVersions, getVersion } from "@/modules/website/queries";
import { PublishThisVersion } from "./PublishThisVersion";

export default async function VersionDetailPage({
  params,
}: {
  params: Promise<{ institution: string; pageId: string; versionId: string }>;
}) {
  const { institution: institutionSlug, pageId, versionId } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "website.edit");

  const page = await getPageWithVersions(ctx, pageId);
  if (!page) notFound();
  const version = await getVersion(ctx, pageId, versionId);
  if (!version) notFound();

  const isPublished = version.id === page.publishedVersionId;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${page.title} — v${version.versionNo}`}
        back={{ href: `/${institutionSlug}/website/pages/${pageId}`, label: page.title }}
        actions={isPublished ? <Badge variant="success">Published</Badge> : undefined}
      />
      {!isPublished && hasPermission(ctx, "website.publish") && (
        <PublishThisVersion institutionSlug={institutionSlug} pageId={pageId} versionId={versionId} />
      )}
      {/* Read-only: this view has no editor, by design — older versions are never mutated (0010's immutability trigger would reject it anyway). */}
      <DraftPreview blocks={version.blocks} slug={page.slug} institutionId={ctx.institution.id} />
    </div>
  );
}
