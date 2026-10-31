import { EmptyState } from "@/components/states";
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

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/results`);
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
        <EmptyState title="No published results yet" description="Results appear here once the school publishes them." />
      ) : (
        <div className="space-y-6">
          {results.map((result) => (
            // T-020 — the per-paper "Request recheck" affordance is now
            // ReportCard's own "Recheck" column (guardian/student only); no
            // extra slot needed here any more.
            <ReportCard key={result.examId} ctx={ctx} examId={result.examId} studentId={selection.studentId} />
          ))}
        </div>
      )}
    </>
  );
}
