// New — teacher-facing, informational-only attendance pattern insight
// panel. Sits beside `StudentAttendanceSummary`'s existing static
// threshold badge (rendered elsewhere, on the student profile) — this
// does NOT replace it and does not change any grading/status.
//
// Fetches the anonymized pattern data server-side; the client piece below
// sends ONLY that anonymized array to `/api/ai/attendance-insight`.
// Student names are resolved back from THIS component's own (unstripped)
// data after the response returns — entirely server/client local, never
// over the network to the model.
import { buildAnonymizedAttendancePatterns, getSectionAttendancePatterns } from "@/modules/attendance/queries";
import type { TenantContext } from "@/lib/auth/types";
import { AttendanceInsightsPanel } from "@/modules/attendance/components/AttendanceInsightsPanel";

interface AttendanceInsightsProps {
  ctx: TenantContext;
  institutionSlug: string;
  sectionId: string;
  termId: string;
}

export async function AttendanceInsights({ ctx, institutionSlug, sectionId, termId }: AttendanceInsightsProps) {
  const result = await getSectionAttendancePatterns(ctx, sectionId, termId);
  if (!result || result.students.length === 0) return null;

  const names = result.students.map((s) => s.name);
  const patterns = buildAnonymizedAttendancePatterns(result.students);

  return (
    <AttendanceInsightsPanel institutionSlug={institutionSlug} sectionId={sectionId} patterns={patterns} names={names} />
  );
}
