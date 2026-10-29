import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { AttendanceChart } from "@/modules/core/components/dashboard/AttendanceChart";
import { CollectionsChart } from "@/modules/core/components/dashboard/CollectionsChart";
import { FunnelChart } from "@/modules/core/components/dashboard/FunnelChart";
import { GradeDistributionChart } from "@/modules/core/components/dashboard/GradeDistributionChart";
import { KpiTile } from "@/modules/core/components/dashboard/KpiTile";
import { RecentActivity } from "@/modules/core/components/dashboard/RecentActivity";
import { formatINR, getDashboardData } from "@/modules/core/dashboard.queries";

// T-039 — principal dashboard (07 §2.2 `dashboard.view`; finance tiles need
// `finance.read`). `requirePermission` below is the gate: a role without
// `dashboard.view` (e.g. teacher) never reaches `getDashboardData`, so none
// of these aggregates are ever computed for them (CLAUDE.md rule 2).
export default async function DashboardPage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "dashboard.view");

  const data = await getDashboardData(ctx);
  const basePath = `/${institutionSlug}`;
  const enrolledCount = data.funnel.applicationStatuses.enrolled ?? 0;
  const openEnquiries = Object.values(data.funnel.enquiryStages).reduce((sum, n) => sum + n, 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Attendance today"
          value={`${data.attendanceToday.percentage}%`}
          sub={`${data.attendanceToday.totalInDenominator} students marked`}
          href={`${basePath}/attendance`}
        />
        <KpiTile
          label="Sections below threshold"
          value={String(data.sectionsAtRisk.length)}
          sub={data.sectionsAtRisk[0] ? `Lowest: ${data.sectionsAtRisk[0].label}` : "None today"}
          href={`${basePath}/attendance`}
        />
        <KpiTile label="Open enquiries" value={String(openEnquiries)} sub={`${enrolledCount} enrolled this year`} href={`${basePath}/admissions`} />
        {data.collections && (
          <KpiTile
            label="Collected this term"
            value={formatINR(data.collections.collectedPaise)}
            sub={`of ${formatINR(data.collections.duePaise)} due`}
            href={`${basePath}/finance`}
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Attendance today</CardTitle>
          </CardHeader>
          <CardContent>
            <AttendanceChart presentWeighted={data.attendanceToday.presentWeighted} totalInDenominator={data.attendanceToday.totalInDenominator} />
          </CardContent>
        </Card>

        {data.collections ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Fee collection this term</CardTitle>
            </CardHeader>
            <CardContent>
              <CollectionsChart collectedPaise={data.collections.collectedPaise} duePaise={data.collections.duePaise} />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Admissions funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <FunnelChart funnel={data.funnel} />
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data.collections && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Admissions funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <FunnelChart funnel={data.funnel} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Exam grade distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {data.gradeDistribution ? (
              <>
                <p className="text-muted-foreground mb-2 text-sm">
                  {data.gradeDistribution.examName} — {data.gradeDistribution.total} results
                </p>
                <GradeDistributionChart distribution={data.gradeDistribution.distribution} />
              </>
            ) : (
              <p className="text-muted-foreground text-sm">No published exam yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Sections below threshold today</CardTitle>
          </CardHeader>
          <CardContent>
            {data.sectionsAtRisk.length === 0 ? (
              <p className="text-muted-foreground text-sm">Every section is above the critical threshold.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.sectionsAtRisk.map((section) => (
                  <li key={section.classSectionId} className="flex justify-between gap-2 border-border border-b py-1 last:border-0">
                    <Link href={`${basePath}/attendance/${section.classSectionId}`} className="hover:underline">
                      {section.label}
                    </Link>
                    <span className="font-medium">{section.percentage}%</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {data.recentActivity && <RecentActivity entries={data.recentActivity} />}
      </div>
    </div>
  );
}
