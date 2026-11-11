import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { aiTaskOn } from "@/modules/ai/task-route";
import { ThemeEditor } from "@/modules/website/components/ThemeEditor";
import { getWebsite } from "@/modules/website/queries";
import { DEFAULT_WEBSITE_THEME } from "@/modules/website/theme";

export const metadata: Metadata = { title: "Website look" };

export default async function WebsiteThemePage({ params }: { params: Promise<{ institution: string }> }) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "website");
  // Saving the look changes the live site at once, so it is a website.publish screen.
  requirePermission(ctx, "website.publish");

  const website = await getWebsite(ctx);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Website look"
        description="Colours, fonts, corners and hero style for the public site. The site changes when you save."
        back={{ href: `/${institutionSlug}/website`, label: "Website" }}
      />
      <Card>
        <CardContent>
          <ThemeEditor
            institutionSlug={institutionSlug}
            institutionName={ctx.institution.name}
            initialTheme={website?.theme ?? DEFAULT_WEBSITE_THEME}
            aiOn={aiTaskOn(ctx, "website_theme_draft")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
