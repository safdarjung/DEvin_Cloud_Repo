import type { Metadata } from "next";
import { FadeIn } from "@/components/motion";
import { EmptyState } from "@/components/states";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission, hasPermission } from "@/lib/auth/require";
import { StudentAttendanceSummary } from "@/modules/attendance/components/StudentAttendanceSummary";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { getCurrentTermId, getStudentProfile } from "@/modules/people/queries";
import { resolvePortalSelection } from "@/modules/people/portal";

export const metadata: Metadata = { title: "Attendance" };

export default async function PortalAttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const allParams = await searchParams;
  const { student: studentParam } = allParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "attendance.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal/attendance`, allParams);
  const profile = await getStudentProfile(ctx, selection.studentId);
  const termId = profile?.enrolment ? await getCurrentTermId(ctx, profile.enrolment.academicYearId) : null;

  return (
    <>
      <PortalNav
        institutionSlug={institutionSlug}
        role={ctx.membership.role as "guardian" | "student"}
        selection={selection}
        activeHref="/attendance"
        canStudy={hasPermission(ctx, "ai.study")}
      />
      {termId ? (
        <FadeIn key={selection.studentId}>
          <StudentAttendanceSummary ctx={ctx} studentId={selection.studentId} termId={termId} studentName={selection.studentName} />
        </FadeIn>
      ) : (
        <EmptyState title="No attendance to show" description="No active enrolment or term to show attendance for." />
      )}
    </>
  );
}
