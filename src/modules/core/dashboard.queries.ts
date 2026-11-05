import "server-only";
// T-039 — principal dashboard. Composes each owning module's `// dashboard`
// aggregate under the caller's own RLS (no service role, CLAUDE.md rule 1).
// Callers MUST call `requirePermission(ctx, "dashboard.view")` before this —
// a role without it (e.g. teacher) must never reach this function, so its
// numbers are never computed for them. Finance fields are omitted entirely
// (not zeroed) without `finance.read` (07 §2.2).
import type { TenantContext } from "@/lib/auth/types";
import {
  attendanceTodaySummary,
  sectionsBelowThreshold,
  type AttendanceTodaySummary,
  type SectionAttendanceAlert,
} from "@/modules/attendance/queries";
import { getAdmissionsFunnelCounts, type AdmissionsFunnelCounts } from "@/modules/admissions/queries";
import { examGradeDistribution, type ExamGradeDistribution } from "@/modules/exams/queries";
import { listAcademicYears, termCollectionSummary, type TermCollectionSummary } from "@/modules/finance/queries";
import { listDeliveryLog, type DeliveryLogRow } from "@/modules/notifications/queries";
import { getCurrentTermId } from "@/modules/people/queries";

export interface DashboardDTO {
  attendanceToday: AttendanceTodaySummary;
  sectionsAtRisk: SectionAttendanceAlert[];
  funnel: AdmissionsFunnelCounts;
  gradeDistribution: ExamGradeDistribution | null;
  /** null when the caller lacks `finance.read` — never a zeroed tile. */
  collections: TermCollectionSummary | null;
  /** Simulated channel (SMS/email) delivery log — null when the caller lacks `notification.log.read`; render with <SimulatedBadge /> when present (rule 7). */
  recentActivity: DeliveryLogRow[] | null;
}

/** Rounds a percentage to 2 decimal places without float drift from repeated division. */
export function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Formats integer paise as a locale INR string, e.g. 123456 -> "₹1,234.56". */
export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

export async function currentTermCollections(ctx: TenantContext): Promise<TermCollectionSummary | null> {
  const years = await listAcademicYears(ctx);
  const currentYear = years[0];
  if (!currentYear) return null;
  const termId = await getCurrentTermId(ctx, currentYear.id);
  if (!termId) return null;
  return termCollectionSummary(ctx, termId);
}

export async function getDashboardData(ctx: TenantContext): Promise<DashboardDTO> {
  const canReadFinance = ctx.permissions.has("finance.read");
  const canReadActivity = ctx.permissions.has("notification.log.read");

  const [attendanceToday, sectionsAtRisk, funnel, gradeDistribution, collections, recentActivity] = await Promise.all([
    attendanceTodaySummary(ctx),
    sectionsBelowThreshold(ctx),
    getAdmissionsFunnelCounts(ctx),
    examGradeDistribution(ctx),
    canReadFinance ? currentTermCollections(ctx) : Promise.resolve(null),
    canReadActivity ? listDeliveryLog(ctx, 10) : Promise.resolve(null),
  ]);

  return { attendanceToday, sectionsAtRisk, funnel, gradeDistribution, collections, recentActivity };
}
