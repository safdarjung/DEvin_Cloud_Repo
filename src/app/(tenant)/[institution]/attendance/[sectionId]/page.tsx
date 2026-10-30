import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { AttendanceInsights } from "@/modules/attendance/components/AttendanceInsights";
import { AttendanceRegister } from "@/modules/attendance/components/AttendanceRegister";
import { getAttendanceSettings, getSession } from "@/modules/attendance/queries";
import { listAcademicYears } from "@/modules/finance/queries";
import { getCurrentTermId } from "@/modules/people/queries";

export default async function AttendanceRegisterPage({
  params,
  searchParams,
}: {
  params: Promise<{ institution: string; sectionId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { institution: institutionSlug, sectionId } = await params;
  const { date: dateParam } = await searchParams;
  const ctx = await getTenantContext(institutionSlug);
  requirePermission(ctx, "attendance.mark");

  const date = dateParam ?? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

  const register = await getSession(ctx, sectionId, date);
  if (!register) notFound();

  // Packet AC1: a teacher may open only the section they are the class
  // teacher of (RLS already scopes reads/writes further; this is the page
  // guard so a teacher of a DIFFERENT section gets a clean 403, not an
  // empty register for a section they can't act on).
  if (ctx.membership.role === "teacher" && register.section.classTeacherId !== ctx.membership.staffId) {
    notFound();
  }

  const { statuses } = getAttendanceSettings(ctx);

  // New — attendance-pattern-insight panel (informational only, AC per
  // packet). `attendance.read` gate matches the panel's own data source;
  // a missing/undetermined current term just means the panel has nothing
  // to analyze, not a page error.
  const years = hasPermission(ctx, "attendance.read") ? await listAcademicYears(ctx) : [];
  const currentYear = years[0];
  const termId = currentYear ? await getCurrentTermId(ctx, currentYear.id) : null;

  return (
    <div className="space-y-4">
      {termId && hasPermission(ctx, "attendance.read") && (
        <AttendanceInsights ctx={ctx} institutionSlug={institutionSlug} sectionId={sectionId} termId={termId} />
      )}
      <AttendanceRegister
        institutionSlug={institutionSlug}
        sectionId={sectionId}
        sectionLabel={register.section.label}
        date={date}
        students={register.students}
        statuses={statuses}
        initialSessionId={register.session?.id ?? null}
        initialSessionStatus={register.session?.status ?? null}
        canCorrect={hasPermission(ctx, "attendance.correct")}
      />
    </div>
  );
}
