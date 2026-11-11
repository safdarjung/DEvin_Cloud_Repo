import { FadeIn } from "@/components/motion";
import { ErrorState } from "@/components/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { CanteenHistory, paise } from "@/modules/canteen/components/CanteenHistory";
import { canteenStatement } from "@/modules/canteen/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

// Guardian (own children) / student (self): canteen balance + history.
// RLS scopes the ledger; the balance is canteen_balance() only.
export default async function PortalCanteenPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  requireModule(ctx, "canteen");
  requirePermission(ctx, "canteen.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/canteen`, allParams);
  const statement = await canteenStatement(ctx, selection.studentId).catch((err: unknown) => {
    console.error("portal canteen fetch failed:", err instanceof Error ? err.message : err);
    return null;
  });

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />

      <FadeIn key={selection.studentId} className="space-y-4">
        {!statement ? (
          <ErrorState title="Could not load the canteen account" description="Refresh to try again." />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Canteen balance</CardTitle>
                <CardDescription>{selection.studentName}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className={`text-3xl font-semibold tabular-nums ${statement.balancePaise <= 0 ? "text-destructive" : ""}`}>{paise(statement.balancePaise)}</p>
                <p className="text-sm text-muted-foreground">Top-ups are recorded by the school office. This app does not take payments.</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Recent activity</CardTitle>
              </CardHeader>
              <CardContent>
                <CanteenHistory transactions={statement.transactions} />
              </CardContent>
            </Card>
          </>
        )}
      </FadeIn>
    </>
  );
}
