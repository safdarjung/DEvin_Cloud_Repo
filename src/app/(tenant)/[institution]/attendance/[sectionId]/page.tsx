import { notFound } from "next/navigation";
import { getTenantContext } from "@/lib/auth/context";
import { hasPermission, requirePermission } from "@/lib/auth/require";
import { AttendanceRegister } from "@/modules/attendance/components/AttendanceRegister";
import { getAttendanceSettings, getSession } from "@/modules/attendance/queries";

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

  return (
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
  );
}
