import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { PageList } from "@/modules/website/components/PageList";
import { getWebsite, listPages } from "@/modules/website/queries";
import { WebsiteLiveToggle } from "./WebsiteLiveToggle";

export default async function WebsitePage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "website");
  requirePermission(ctx, "website.edit");

  const [pages, website] = await Promise.all([listPages(ctx), getWebsite(ctx)]);
  const canPublish = hasPermission(ctx, "website.publish");

  return (
    <div className="space-y-4">
      <PageHeader
        title="Website"
        description="Edit pages, preview drafts, and publish — the public site changes only when you publish."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href={`/${institutionSlug}/website/notices`}>Notices</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/${institutionSlug}/website/events`}>Events</Link>
            </Button>
            {canPublish && <WebsiteLiveToggle institutionSlug={institutionSlug} isLive={website?.isLive ?? false} />}
          </>
        }
      />
      <PageList institutionSlug={institutionSlug} pages={pages} canEdit={hasPermission(ctx, "website.edit")} />
    </div>
  );
}
