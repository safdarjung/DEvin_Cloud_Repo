import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/require";
import { listStudentAssignments } from "@/modules/academics/assignments.queries";
import { getStudentAttendanceSummary } from "@/modules/attendance/queries";
import { listResultsForStudent } from "@/modules/exams/queries";
import { listInvoicesForStudent } from "@/modules/finance/queries";
import { PortalNav } from "@/modules/people/components/PortalNav";
import { getCurrentTermId, getStudentProfile } from "@/modules/people/queries";
import { resolvePortalSelection } from "@/modules/people/portal";

// T-034 — overview tiles (F-STU-02/11): attendance % this term, outstanding
// fees, latest result, open assignments. Each tile links into its own tab.
export default async function PortalOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string }>;
  searchParams: Promise<{ student?: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const { student: studentParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "student.read");
  // Fix round 1 (packet rule 3) — each tile reads a different tab's data,
  // so each needs that tab's own permission check too, not just the page
  // floor above.
  requirePermission(ctx, "attendance.read");
  requirePermission(ctx, "finance.read");
  requirePermission(ctx, "exam.result.read");
  requirePermission(ctx, "assignment.read");

  const selection = await resolvePortalSelection(ctx, studentParam, `/${institutionSlug}/portal`);
  const profile = await getStudentProfile(ctx, selection.studentId);
  const termId = profile?.enrolment ? await getCurrentTermId(ctx, profile.enrolment.academicYearId) : null;

  const [attendance, invoices, results, assignments] = await Promise.all([
    termId ? getStudentAttendanceSummary(ctx, selection.studentId, termId) : Promise.resolve(null),
    listInvoicesForStudent(ctx, selection.studentId),
    listResultsForStudent(ctx, selection.studentId),
    listStudentAssignments(ctx, selection.studentId),
  ]);

  const outstanding = invoices.reduce((sum, inv) => sum + (inv.total - inv.paidTotal), 0);
  const latestResult = results[0] ?? null;
  const basePath = `/${institutionSlug}/portal`;

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role={ctx.membership.role as "guardian" | "student"} selection={selection} activeHref="" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href={`${basePath}/attendance?student=${selection.studentId}`}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Attendance this term</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{attendance ? `${attendance.percentage.toFixed(2)}%` : "—"}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href={`${basePath}/fees?student=${selection.studentId}`}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Outstanding fees</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{outstanding.toFixed(2)}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href={`${basePath}/results?student=${selection.studentId}`}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Latest result</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{latestResult ? `${latestResult.grade}` : "—"}</p>
              <p className="text-muted-foreground text-sm">{latestResult?.examName ?? "No published results yet."}</p>
            </CardContent>
          </Card>
        </Link>

        <Link href={`${basePath}/assignments?student=${selection.studentId}`}>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Open assignments</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold">{assignments.length}</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </>
  );
}
