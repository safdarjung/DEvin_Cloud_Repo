import { PageHeader } from "@/components/page-header";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { DailyBriefing } from "@/modules/core/components/dashboard/DailyBriefing";
import { ActivitySection } from "@/modules/core/components/dashboard/ActivitySection";
import { AdmissionsSection } from "@/modules/core/components/dashboard/AdmissionsSection";
import { AttendanceSection } from "@/modules/core/components/dashboard/AttendanceSection";
import { ExamsSection } from "@/modules/core/components/dashboard/ExamsSection";
import { FinanceSection } from "@/modules/core/components/dashboard/FinanceSection";
import { KpiTile } from "@/modules/core/components/dashboard/KpiTile";
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
  // Fix round 1 (security review, LOW-4): accountant/exam_controller have
  // `dashboard.view` but not `ai.generate` — never render the button for a
  // role that can only get `forbidden` back from the route.
  const canGenerateBriefing = hasPermission(ctx, "ai.generate");

  const role = ctx.membership.role;

  const briefing = canGenerateBriefing && (
    <DailyBriefing
      key="briefing"
      institutionSlug={institutionSlug}
      attendancePercent={data.attendanceToday.percentage}
      sectionsAtRiskCount={data.sectionsAtRisk.length}
      openEnquiries={openEnquiries}
      enrolledCount={enrolledCount}
      collections={data.collections ? { collectedPaise: data.collections.collectedPaise, duePaise: data.collections.duePaise } : null}
    />
  );
  const kpis = (
    <div key="kpis" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
  );
  const enquiryKpi = (
    <KpiTile key="enq" label="Open enquiries" value={String(openEnquiries)} sub={`${enrolledCount} enrolled this year`} href={`${basePath}/admissions`} />
  );
  const attendance = (atRisk: boolean) => <AttendanceSection key="att" data={data} basePath={basePath} showAtRisk={atRisk} />;
  const finance = (links: boolean) =>
    data.collections ? <FinanceSection key="fin" collections={data.collections} basePath={basePath} showLinks={links} /> : null;
  const admissions = <AdmissionsSection key="adm" funnel={data.funnel} />;
  const exams = (rechecks: boolean) => <ExamsSection key="exm" gradeDistribution={data.gradeDistribution} basePath={basePath} showRechecks={rechecks} />;
  const activity = <ActivitySection key="act" entries={data.recentActivity} />;

  // Ordering only: every section reads the same permission-gated DTO.
  let sections;
  switch (role) {
    case "admissions":
      sections = [briefing, enquiryKpi, admissions, attendance(false), exams(false)];
      break;
    case "accountant":
      sections = [finance(true), attendance(false)];
      break;
    case "exam_controller":
      sections = [exams(true), attendance(false)];
      break;
    default:
      sections = [briefing, kpis, attendance(true), finance(false), admissions, exams(false), activity];
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`Today at ${ctx.institution.name}`} />
      {sections}
    </div>
  );
}
