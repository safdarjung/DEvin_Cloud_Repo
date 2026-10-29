import { Button } from "@/components/ui/button";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { ReportCard } from "@/modules/exams/components/ReportCard";
import { listResultsForStudent } from "@/modules/exams/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

export default async function PortalResultsPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "exam.result.read");

  const selection = await resolvePortalSelection(ctx, studentParam);
  const results = await listResultsForStudent(ctx, selection.studentId);

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/results"
      />

      {results.length === 0 ? (
        <p className="text-muted-foreground text-sm">No published results yet.</p>
      ) : (
        <div className="space-y-6">
          {results.map((result) => (
            <div key={result.examId} className="space-y-2">
              <ReportCard ctx={ctx} examId={result.examId} studentId={selection.studentId} />
              {/* T-020 (recheck requests) isn't built yet — slot left here per the
                  packet's assumption; disabled, not a <LimitedBadge /> (not a
                  simulated feature, just not wired up yet). */}
              <Button variant="outline" size="sm" disabled title="Coming soon (T-020)">
                Request recheck
              </Button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
