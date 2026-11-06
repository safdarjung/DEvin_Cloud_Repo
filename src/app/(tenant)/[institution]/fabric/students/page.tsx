import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { FabricPage } from "@/modules/fabric/components/fabric-page";
import { StudentRoster } from "@/modules/fabric/components/success/roster";
import { studentInterventionPlans, studentSuccessRoster, studentSuccessSections } from "@/modules/fabric/students.queries";

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

  return (
    <FabricPage title="Student success" description="Roster, risk signals, and intervention plans from live records." ws="students">
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
