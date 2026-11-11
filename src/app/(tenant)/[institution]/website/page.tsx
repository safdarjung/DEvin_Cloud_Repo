import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FadeIn } from "@/components/motion";
import { ProgressBar } from "@/components/widgets/viz";
import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission, requireModule } from "@/lib/auth/require";
import { PageList } from "@/modules/website/components/PageList";
import { getWebsite, listPages } from "@/modules/website/queries";
import { WebsiteLiveToggle } from "./WebsiteLiveToggle";

export const metadata: Metadata = { title: "Website" };

export default async function WebsitePage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "website");
  requirePermission(ctx, "website.edit");

  const [pages, website] = await Promise.all([listPages(ctx), getWebsite(ctx)]);
  const canPublish = hasPermission(ctx, "website.publish");
  const publishedCount = pages.filter((p) => p.publishedVersionId).length;

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
            {canPublish && (
              <Button variant="outline" asChild>
                <Link href={`/${institutionSlug}/website/theme`}>Look &amp; feel</Link>
              </Button>
            )}
            {canPublish && <WebsiteLiveToggle institutionSlug={institutionSlug} isLive={website?.isLive ?? false} />}
          </>
        }
      />
      <FadeIn>
      <Card>
        {pages.length > 0 && (
          <div className="border-b-2 border-border px-4 pb-3">
            <ProgressBar
              value={publishedCount}
              max={pages.length}
              label="Pages live on the public site"
              valueLabel={`${publishedCount} of ${pages.length}`}
              tone={publishedCount === pages.length ? "success" : "default"}
            />
          </div>
        )}
        <CardContent className="min-w-0 [&_.rounded-lg.border.bg-card]:border-0">
          <PageList institutionSlug={institutionSlug} pages={pages} canEdit={hasPermission(ctx, "website.edit")} />
        </CardContent>
      </Card>
      </FadeIn>
    </div>
  );
}
