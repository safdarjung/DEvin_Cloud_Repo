import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { KpiTile } from "@/modules/core/components/dashboard/KpiTile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
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

  // invoices.total / paid_total are numeric(12,2) rupees (finance/queries.ts), not paise.
  const outstanding = invoices.reduce((sum, inv) => sum + (inv.total - inv.paidTotal), 0);
  const latestResult = results[0] ?? null;
  const basePath = `/${institutionSlug}/portal`;
  const studentName = profile ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") : null;
  const q = `?student=${selection.studentId}`;

  return (
    <>
      <PortalNav institutionSlug={institutionSlug} role={ctx.membership.role as "guardian" | "student"} selection={selection} activeHref="" />
      <PageHeader title="Overview" description={studentName ?? undefined} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Attendance this term" value={attendance ? `${attendance.percentage.toFixed(2)}%` : "—"} href={`${basePath}/attendance${q}`} />
        <KpiTile
          label="Outstanding fees"
          value={new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(outstanding)}
          href={`${basePath}/fees${q}`}
        />
        <KpiTile
          label="Latest result"
          value={latestResult ? `${latestResult.grade}` : "—"}
          sub={latestResult?.examName ?? "No published results yet."}
          href={`${basePath}/results${q}`}
        />
        <KpiTile label="Open assignments" value={String(assignments.length)} href={`${basePath}/assignments${q}`} />

        {/* GU-08 — ai.study is student-only (D32); a guardian viewing a
            child's portal never has it, so this tile simply doesn't
            render for them, rather than linking to a page that would
            always forbid them. */}
        {hasPermission(ctx, "ai.study") && (
          <Link href={`${basePath}/study`} className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Card className="h-full transition-shadow duration-(--duration-fast) ease-out hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">Study helper</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">Ask about a topic, get notes, mindmaps, or practice.</p>
              </CardContent>
            </Card>
          </Link>
        )}
      </div>
    </>
  );
}
