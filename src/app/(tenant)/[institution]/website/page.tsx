import Link from "next/link";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { PageList } from "@/modules/website/components/PageList";
import { getWebsite, listPages } from "@/modules/website/queries";
import { WebsiteLiveToggle } from "./WebsiteLiveToggle";

export default async function WebsitePage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "website.edit");

  const [pages, website] = await Promise.all([listPages(ctx), getWebsite(ctx)]);
  const canPublish = hasPermission(ctx, "website.publish");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Website</h1>
          <p className="text-muted-foreground text-sm">
            Edit pages, preview drafts, and publish — the public site changes only when you publish.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link href={`/${institutionSlug}/website/notices`} className="text-sm underline">
            Notices
          </Link>
          <Link href={`/${institutionSlug}/website/events`} className="text-sm underline">
            Events
          </Link>
          {canPublish && <WebsiteLiveToggle institutionSlug={institutionSlug} isLive={website?.isLive ?? false} />}
        </div>
      </div>
      <PageList institutionSlug={institutionSlug} pages={pages} canEdit={hasPermission(ctx, "website.edit")} />
    </div>
  );
}
