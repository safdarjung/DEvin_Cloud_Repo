import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { BarList } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { humanize } from "@/lib/format";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, requireModule, hasPermission } from "@/lib/auth/require";
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
  requireModule(ctx, "exams");
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
        canStudy={hasPermission(ctx, "ai.study")}
      />

      {results.length === 0 ? (
        <EmptyState title="No published results yet" description="Results appear here once the school publishes them." />
      ) : (
        <FadeIn key={selection.studentId} className="space-y-6">
          {results.length > 1 && (
            <Widget title="Score by exam" description={`${selection.studentName}'s overall percentage in each published exam, newest first.`}>
              <BarList
                ariaLabel="Overall percentage by exam"
                max={100}
                format="percent"
                items={results.map((r) => ({
                  label: r.examName || humanize(r.examType) || "Exam",
                  value: Number(r.percentage),
                  display: `${+Number(r.percentage).toFixed(1)}% · ${r.grade}`,
                }))}
              />
            </Widget>
          )}
          {results.map((result) => (
            // T-020 — the per-paper "Request recheck" affordance is now
            // ReportCard's own "Recheck" column (guardian/student only); no
            // extra slot needed here any more.
            <ReportCard key={result.examId} ctx={ctx} examId={result.examId} studentId={selection.studentId} />
          ))}
        </FadeIn>
      )}
    </>
  );
}
