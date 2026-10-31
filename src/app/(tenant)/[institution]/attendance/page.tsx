import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { getTodaySectionsForTeacher } from "@/modules/attendance/queries";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ institution: string }>;
}) {
  const { institution: institutionSlug } = await params;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "attendance.read");

  const canMark = hasPermission(ctx, "attendance.mark");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  if (!canMark) {
    // Guardian/student/exam_controller: read-only — the per-student summary
    // lives on the student profile and portal (StudentAttendanceSummary),
    // not here. 06 §W5's register is for marking, which this role can't do.
    return (
      <div className="space-y-4">
        <PageHeader
          title="Attendance"
          description="You have read-only access to attendance. See a student's profile or the portal for their summary."
        />
      </div>
    );
  }

  const sections = await getTodaySectionsForTeacher(ctx);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Attendance"
        description={`Today — ${today} · ${sections.length} ${sections.length === 1 ? "section" : "sections"} to mark`}
      />
      {sections.length === 0 ? (
        <EmptyState title="No sections to mark today" />
      ) : (
        <Card>
          <CardContent>
            <ul className="divide-y divide-border">
              {sections.map((section) => (
                <li key={section.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="font-medium">{section.label}</span>
                  <Button asChild variant="outline" className="shrink-0">
                    <Link href={`/${institutionSlug}/attendance/${section.id}?date=${today}`}>Open register</Link>
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
