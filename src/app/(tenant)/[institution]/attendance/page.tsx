import Link from "next/link";
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
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">Attendance</h1>
        <p className="text-muted-foreground text-sm">
          You have read-only access to attendance. See a student&apos;s profile or the portal for their summary.
        </p>
      </div>
    );
  }

  const sections = await getTodaySectionsForTeacher(ctx);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Attendance</h1>
        <p className="text-muted-foreground text-sm">Today — {today}</p>
      </div>
      {sections.length === 0 ? (
        <p className="text-muted-foreground text-sm">No sections to mark.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {sections.map((section) => (
            <li key={section.id} className="flex items-center justify-between p-3">
              <span>{section.label}</span>
              <Link
                href={`/${institutionSlug}/attendance/${section.id}?date=${today}`}
                className="text-primary text-sm underline-offset-2 hover:underline"
              >
                Open register
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
