import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getTenantContext } from "@/lib/auth/context";
import type { TenantContext } from "@/lib/auth/types";
import { requireModule, requirePermission } from "@/lib/auth/require";
import { ProfileForm, VaccinationForm, VisitForm } from "@/modules/health/components/HealthForms";
import { ProfileSummary, Section, VaccinationsTable, VisitsTable } from "@/modules/health/components/HealthRecords";
import { healthProfile, healthStudentOptions, healthVaccinations, healthVisits } from "@/modules/health/queries";

export const metadata: Metadata = { title: "Health" };

async function loadHealth(ctx: TenantContext, student?: string) {
  const students = await healthStudentOptions(ctx);
  const studentId = students.some((s) => s.id === student) ? student : undefined;
  const detail = studentId
    ? await Promise.all([healthProfile(ctx, studentId), healthVisits(ctx, studentId), healthVaccinations(ctx, studentId)])
    : null;
  const [profile, visits, vaccinations] = detail ?? [null, [], []];
  const recent = detail ? [] : await healthVisits(ctx);
  return { students, studentId, profile, visits, vaccinations, recent };
}

// Student health: profile, infirmary visits, vaccinations. Sensitive — staff roles with health.read/health.write only.
export default async function HealthPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: slug } = await params;
  const { student } = await searchParams;
  const ctx = await getTenantContext(slug);
  requireModule(ctx, "health");
  // Guardians hold health.read (own child, portal only); this staff page needs health.write.
  requirePermission(ctx, "health.write");

  const data = await loadHealth(ctx, student).catch((e) => {
    console.error("health page failed:", e instanceof Error ? e.message : "unknown");
    return null;
  });
  if (!data) return <ErrorState title="Could not load health records" description="Refresh to try again." />;
  const { students, studentId, profile, visits, vaccinations, recent } = data;

  return (
    <div className="space-y-6">
      <PageHeader title="Student health" description="Health profiles, infirmary visits and vaccinations. Confidential: visible to school leadership and each child's guardians only." />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <div className="min-w-64">
          <Label htmlFor="health-student">Student</Label>
          <select id="health-student" name="student" defaultValue={studentId ?? ""} className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm">
            <option value="">Select a student</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit">Open</Button>
      </form>

      {studentId ? (
        <>
          <Section title="Profile">
            <ProfileSummary profile={profile} />
          </Section>
          <Section title="Edit profile">
            <ProfileForm key={profile?.id ?? "new"} institutionSlug={slug} studentId={studentId} profile={profile} />
          </Section>
          <Section title="Infirmary visits">
            <VisitsTable visits={visits} />
          </Section>
          <Section title="Add visit">
            <VisitForm institutionSlug={slug} studentId={studentId} />
          </Section>
          <Section title="Vaccinations">
            <VaccinationsTable rows={vaccinations} />
          </Section>
          <Section title="Add vaccination">
            <VaccinationForm institutionSlug={slug} studentId={studentId} />
          </Section>
        </>
      ) : (
        <Section title="Recent infirmary visits">
          <VisitsTable visits={recent} showStudent />
        </Section>
      )}
    </div>
  );
}
