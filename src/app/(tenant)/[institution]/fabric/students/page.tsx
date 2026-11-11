import type { Metadata } from "next";
import { BarList, RadialGauge } from "@/components/widgets/viz";
import { Widget } from "@/components/widgets/widget";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { StudentRoster } from "@/modules/fabric/components/success/roster";
import { studentInterventionPlans, studentSuccessRoster, studentSuccessSections } from "@/modules/fabric/students.queries";

export const metadata: Metadata = { title: "Student success" };

const RISK_FILTERS = new Set(["watch", "support"]);

export default async function StudentSuccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ section?: string; risk?: string; topic?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { section, risk, topic } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "mastery.read");

  // One section per view: an all-sections roster was one mastery query set per section (72 on the
  // demo tenant) and took ~35s on hosted. The section picker navigates with ?section=<id>.
  const sections = await studentSuccessSections(ctx);
  const activeId = sections.find((s) => s.id === section)?.id ?? sections[0]?.id;
  const [rows, plans] = activeId
    ? await Promise.all([
        studentSuccessRoster(ctx, { classSectionId: activeId }),
        studentInterventionPlans(ctx, { classSectionId: activeId }),
      ])
    : [[], []];

  const avg = (pick: (r: (typeof rows)[number]) => number) => (rows.length ? rows.reduce((n, r) => n + pick(r), 0) / rows.length : 0);
  const activeLabel = sections.find((s) => s.id === activeId)?.label;

  return (
    <FabricPage title="Student success" description="Roster, risk signals, and intervention plans from live records." ws="students">
      {rows.length > 0 && (
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <Widget title="Section averages" description={activeLabel ? `${rows.length} students in ${activeLabel}` : `${rows.length} students`}>
            <div className="flex flex-wrap gap-6">
              <RadialGauge value={avg((r) => r.attendance_pct)} label="Attendance" sublabel="average" />
              <RadialGauge value={avg((r) => r.mastery_pct)} label="Mastery" sublabel="average" />
            </div>
          </Widget>
          <Widget title="Risk mix" description="Students by current risk signal">
            <BarList
              ariaLabel="Students by risk signal"
              items={[
                { label: "On track", value: rows.filter((r) => r.risk === "none").length, tone: "success" as const },
                { label: "Watch", value: rows.filter((r) => r.risk === "watch").length, tone: "warning" as const },
                { label: "Support", value: rows.filter((r) => r.risk === "support").length, tone: "destructive" as const },
              ]}
            />
          </Widget>
        </div>
      )}
      <StudentRoster
        institutionSlug={institutionSlug}
        rows={rows}
        sections={sections}
        plans={plans}
        canReview={hasPermission(ctx, "mastery.review")}
        activeSectionId={activeId ?? ""}
        initialRisk={risk && RISK_FILTERS.has(risk) ? (risk as "watch" | "support") : "all"}
        initialSearch={topic ?? ""}
      />
    </FabricPage>
  );
}
