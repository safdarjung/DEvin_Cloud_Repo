import "server-only";
// M16-T5 — approvals union (demoApprovals replacement, core/demo/fixtures.ts).
// No new SQL: two RLS-scoped TS reads behind their own permission + module
// gate (06 rulings "Approvals union" — a source is skipped, never queried,
// unless both hold). RLS is unchanged.
import type { TenantContext } from "@/lib/auth/types";
import type { ApprovalRow } from "@/components/widgets/approvals-widget";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { pendingLeaveApprovals } from "@/modules/people/hr.queries";
import { listRecheckQueue } from "@/modules/exams/queries";

function recheckAgeLabel(createdAt: string): string {
  const hours = Math.round((Date.now() - Date.parse(createdAt)) / 3_600_000);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * The approvals widget's union: pending leave (M08) then pending recheck
 * requests (T-020), each oldest first. Each source needs its own
 * permission AND module, or it is skipped entirely (never queried).
 */
export async function pendingApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const canSeeLeave = ctx.permissions.has("leave.approve") && isModuleEnabled(ctx, "staff_attendance");
  const canSeeRecheck = ctx.permissions.has("exam.recheck.review") && isModuleEnabled(ctx, "exams");

  const [leaveRows, recheckRows] = await Promise.all([
    canSeeLeave ? pendingLeaveApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeRecheck ? pendingRecheckApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
  ]);

  return [...leaveRows, ...recheckRows];
}

async function pendingRecheckApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const href = `/${ctx.institution.slug}/exams/rechecks`;
  const [submitted, underReview] = await Promise.all([
    listRecheckQueue(ctx, "submitted"),
    listRecheckQueue(ctx, "under_review"),
  ]);
  return [...submitted, ...underReview]
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))
    .map((row) => ({
      id: row.id,
      kind: "recheck",
      title: `Recheck: ${row.subjectName}, ${row.examName}`,
      requestedBy: row.studentName,
      age: recheckAgeLabel(row.requestedAt),
      href,
    }));
}
