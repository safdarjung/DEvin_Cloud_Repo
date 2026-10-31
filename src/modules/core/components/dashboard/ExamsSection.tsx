import Link from "next/link";
import { EmptyState } from "@/components/states";
import type { DashboardDTO } from "@/modules/core/dashboard.queries";
import { GradeDistributionChart } from "./GradeDistributionChart";
import { Section } from "./Section";

export function ExamsSection({ gradeDistribution, basePath, showRechecks = false }: { gradeDistribution: DashboardDTO["gradeDistribution"]; basePath: string; showRechecks?: boolean }) {
  return (
    <Section title="Exam grade distribution">
      {gradeDistribution ? (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {gradeDistribution.examName} — {gradeDistribution.total} results
          </p>
          <GradeDistributionChart distribution={gradeDistribution.distribution} />
        </>
      ) : (
        <EmptyState title="No published exam yet" description="Grade distribution appears once results are published." />
      )}
      {showRechecks && (
        <Link href={`${basePath}/exams/rechecks`} className="mt-4 inline-block text-sm font-medium underline-offset-4 hover:underline">
          Review recheck requests
        </Link>
      )}
    </Section>
  );
}
