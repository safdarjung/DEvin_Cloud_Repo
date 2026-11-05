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
import { listInsights } from "@/modules/insights/queries";

function recheckAgeLabel(createdAt: string): string {
  const hours = Math.round((Date.now() - Date.parse(createdAt)) / 3_600_000);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * The approvals widget's union: pending leave (M08), then pending recheck
 * requests (T-020), then pending-approval insights (M19-T20), each oldest
 * first. Each source needs its own permission AND module, or it is skipped
 * entirely (never queried).
 */
export async function pendingApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const canSeeLeave = ctx.permissions.has("leave.approve") && isModuleEnabled(ctx, "staff_attendance");
  const canSeeRecheck = ctx.permissions.has("exam.recheck.review") && isModuleEnabled(ctx, "exams");
  const canSeeInsight = ctx.permissions.has("insight.review") && isModuleEnabled(ctx, "insights");

  const [leaveRows, recheckRows, insightRows] = await Promise.all([
    canSeeLeave ? pendingLeaveApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeRecheck ? pendingRecheckApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeInsight ? pendingInsightApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
  ]);

  return [...leaveRows, ...recheckRows, ...insightRows];
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

/**
 * Visible `insights` that are open and need approval (rulings "Approvals",
 * M19 §T20). RLS (0092) + `listInsights` already scope the rows; this just
 * keeps `approval_required` ones and maps to `ApprovalRow`, oldest first.
 */
async function pendingInsightApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const rows = await listInsights(ctx, { status: ["new", "reviewing"], limit: 200 });
  return rows
    .filter((row) => row.approval_required)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((row) => ({
      id: row.id,
      kind: "insight",
      title: `Insight: ${row.title}`,
      requestedBy: "Insights engine",
      age: recheckAgeLabel(row.created_at),
      href: `/${ctx.institution.slug}/fabric/insights?id=${row.id}`,
    }));
}
