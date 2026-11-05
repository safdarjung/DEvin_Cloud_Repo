import "server-only";
// M16-T5 — approvals union (demoApprovals replacement, core/demo/fixtures.ts).
// No new SQL: two RLS-scoped TS reads behind their own permission + module
// gate (06 rulings "Approvals union" — a source is skipped, never queried,
// unless both hold). RLS is unchanged.
// M22-T10 adds a third source: agent_run (06-backend-packets/M22-tasks.md
// rulings "Approvals union") — awaiting_approval runs the caller canDecideRun.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { ApprovalRow } from "@/components/widgets/approvals-widget";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { pendingLeaveApprovals } from "@/modules/people/hr.queries";
import { listRecheckQueue } from "@/modules/exams/queries";
import { AGENT_CATALOG, canDecideRun, type AgentSlug, type RiskClass } from "@/modules/agents/catalog";

function recheckAgeLabel(createdAt: string): string {
  const hours = Math.round((Date.now() - Date.parse(createdAt)) / 3_600_000);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * The approvals widget's union: pending leave (M08), pending recheck
 * requests (T-020), then pending agent runs (M22), each oldest first. Each
 * source needs its own permission AND module, or it is skipped entirely
 * (never queried).
 */
export async function pendingApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const canSeeLeave = ctx.permissions.has("leave.approve") && isModuleEnabled(ctx, "staff_attendance");
  const canSeeRecheck = ctx.permissions.has("exam.recheck.review") && isModuleEnabled(ctx, "exams");
  const canSeeAgentRuns = ctx.permissions.has("agent.run") && isModuleEnabled(ctx, "agents");

  const [leaveRows, recheckRows, agentRunRows] = await Promise.all([
    canSeeLeave ? pendingLeaveApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeRecheck ? pendingRecheckApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeAgentRuns ? pendingAgentRunApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
  ]);

  return [...leaveRows, ...recheckRows, ...agentRunRows];
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

async function pendingAgentRunApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select("id, requested_by, risk_class, proposals, created_at, agent_definitions!inner(slug)")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const canApprove = ctx.permissions.has("agent.approve");
  const decidable = (data ?? []).filter((row) =>
    canDecideRun(
      { userId: ctx.user.id, canApprove },
      { risk_class: row.risk_class as RiskClass, requested_by: row.requested_by },
    ),
  );
  if (decidable.length === 0) return [];

  const requesterIds = [...new Set(decidable.map((row) => row.requested_by))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", requesterIds);
  if (profileError) throw profileError;
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? ""]));

  return decidable.map((row) => {
    const slug = (row.agent_definitions as unknown as { slug: AgentSlug }).slug;
    const proposalCount = ((row.proposals as unknown[] | null) ?? []).length;
    return {
      id: row.id,
      kind: "agent_run",
      title: `${AGENT_CATALOG[slug].name}: ${proposalCount} action(s) to approve`,
      requestedBy: nameById.get(row.requested_by) ?? "",
      age: recheckAgeLabel(row.created_at),
    };
  });
}
