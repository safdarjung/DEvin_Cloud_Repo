import type { Metadata } from "next";
import { EmptyState, ErrorState } from "@/components/states";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { PortfolioView } from "@/modules/achievements/components/PortfolioView";
import { studentPortfolio } from "@/modules/achievements/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Achievements" };

// Read-only. RLS already hides voided rows from guardian/student; the query filters again.
// The portfolio is both the timeline and the printable view.
export default async function PortalAchievementsPage({
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
  requireModule(ctx, "achievements");
  requirePermission(ctx, "achievement.read");

  const selection = await resolvePortalSelection(ctx, student, `/${slug}/portal/achievements`, allParams);
  const nav = <PortalNav institutionSlug={slug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />;

  let portfolio;
  try {
    portfolio = await studentPortfolio(ctx, selection.studentId);
  } catch (e) {
    console.error("portal achievements fetch failed:", e instanceof Error ? e.message : e);
    return (
      <>
        {nav}
        <ErrorState title="Could not load achievements" description="Refresh to try again." />
      </>
    );
  }

  return (
    <>
      {nav}
      {portfolio.entries.length === 0 ? (
        <EmptyState title="No achievements yet." description="Awards and recognition recorded by the school appear here." />
      ) : (
        <Card>
          <CardContent className="pt-4">
            <PortfolioView portfolio={portfolio} schoolName={ctx.institution.name} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
