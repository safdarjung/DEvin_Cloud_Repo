import { ErrorState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { ProfileSummary, Section, VaccinationsTable, VisitsTable } from "@/modules/health/components/HealthRecords";
import { healthProfile, healthVaccinations, healthVisits } from "@/modules/health/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { resolvePortalSelection } from "@/modules/people/portal";

// Guardian read-only view of the selected child's health record (RLS narrows to own children).
export default async function PortalHealthPage({
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
  requireModule(ctx, "health");
  requirePermission(ctx, "health.read");

  const selection = await resolvePortalSelection(ctx, student, `/${slug}/portal/health`, allParams);
  const nav = <PortalNav institutionSlug={slug} role={ctx.membership.role as "guardian" | "student"} selection={selection} />;
  const data = await Promise.all([
    healthProfile(ctx, selection.studentId),
    healthVisits(ctx, selection.studentId),
    healthVaccinations(ctx, selection.studentId),
  ]).catch((e) => {
    console.error("portal health failed:", e instanceof Error ? e.message : "unknown");
    return null;
  });
  if (!data) {
    return (
      <>
        {nav}
        <ErrorState title="Could not load health records" description="Refresh to try again." />
      </>
    );
  }
  const [profile, visits, vaccinations] = data;
  return (
    <>
      {nav}
      <div className="space-y-6">
        <Section title={`Health profile: ${selection.studentName}`}>
          <ProfileSummary profile={profile} />
        </Section>
        <Section title="Infirmary visits">
          <VisitsTable visits={visits} />
        </Section>
        <Section title="Vaccinations">
          <VaccinationsTable rows={vaccinations} />
        </Section>
      </div>
    </>
  );
}
