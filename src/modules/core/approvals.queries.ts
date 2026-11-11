import "server-only";
// M16-T5 — approvals union (demoApprovals replacement, core/demo/fixtures.ts).
// No new SQL: two RLS-scoped TS reads behind their own permission + module
// gate (06 rulings "Approvals union" — a source is skipped, never queried,
// unless both hold). RLS is unchanged.
// M22-T10 adds a third source: agent_run (06-backend-packets/M22-tasks.md
// rulings "Approvals union") — awaiting_approval runs the caller canDecideRun.
// M23-T18 adds a fourth source: workflow_run (awaiting a human decision), and
// extends the agent_run source with a workflow's own queued agent task
// (status "queued", visible only to the person who requested it — it is not
// an approval decision).
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { ApprovalRow } from "@/components/widgets/approvals-widget";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { pendingLeaveApprovals } from "@/modules/people/hr.queries";
import { listRecheckQueue } from "@/modules/exams/queries";
import { AGENT_CATALOG, canDecideRun, type AgentSlug, type RiskClass } from "@/modules/agents/catalog";
import { listInsights } from "@/modules/insights/queries";

function recheckAgeLabel(createdAt: string): string {
  const hours = Math.round((Date.now() - Date.parse(createdAt)) / 3_600_000);
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`;
}

/**
 * The approvals widget's union: pending leave (M08), pending recheck
 * requests (T-020), pending-approval insights (M19-T20), then pending agent
 * runs (M22), each oldest first. Each source needs its own permission AND
 * module, or it is skipped entirely (never queried).
 */
export async function pendingApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const canSeeLeave = ctx.permissions.has("leave.approve") && isModuleEnabled(ctx, "staff_attendance");
  const canSeeRecheck = ctx.permissions.has("exam.recheck.review") && isModuleEnabled(ctx, "exams");
  const canSeeInsight = ctx.permissions.has("insight.review") && isModuleEnabled(ctx, "insights");
  const canSeeAgentRuns = ctx.permissions.has("agent.run") && isModuleEnabled(ctx, "agents");
  const canSeeWorkflowRuns = ctx.permissions.has("workflow.manage") && isModuleEnabled(ctx, "workflows");

  const [leaveRows, recheckRows, insightRows, agentRunRows, workflowRunRows] = await Promise.all([
    canSeeLeave ? pendingLeaveApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeRecheck ? pendingRecheckApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeInsight ? pendingInsightApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeAgentRuns ? pendingAgentRunApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
    canSeeWorkflowRuns ? pendingWorkflowRunApprovals(ctx) : Promise.resolve([] as ApprovalRow[]),
  ]);

  return [...leaveRows, ...recheckRows, ...insightRows, ...agentRunRows, ...workflowRunRows];
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
    .select("id, requested_by, risk_class, proposals, status, workflow_run_id, created_at, agent_definitions!inner(slug, name)")
    .eq("institution_id", ctx.institution.id)
    .in("status", ["awaiting_approval", "queued"])
    .order("created_at", { ascending: true });
  if (error) throw error;

  const canApprove = ctx.permissions.has("agent.approve");
  const decidable = (data ?? []).filter(
    (row) =>
      row.status === "awaiting_approval" &&
      canDecideRun(
        { userId: ctx.user.id, canApprove },
        { risk_class: row.risk_class as RiskClass, requested_by: row.requested_by },
      ),
  );
  // M23-T18: a workflow's own queued agent task — not a decision, so visible
  // only to the person who requested it (never to another admin/approver).
  const queuedOwnTask = (data ?? []).filter(
    (row) => row.status === "queued" && row.workflow_run_id !== null && row.requested_by === ctx.user.id,
  );
  const rows = [...decidable, ...queuedOwnTask];
  if (rows.length === 0) return [];

  const requesterIds = [...new Set(rows.map((row) => row.requested_by))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", requesterIds);
  if (profileError) throw profileError;
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? ""]));

  return rows.map((row) => {
    const def = row.agent_definitions as unknown as { slug: AgentSlug; name: string | null };
    // Custom agents (0134) carry their own name; catalog rows take the catalog's.
    const agentName = def.name ?? AGENT_CATALOG[def.slug]?.name ?? "Agent";
    const title =
      row.status === "queued"
        ? `${agentName}: workflow task waiting to start`
        : `${agentName}: ${((row.proposals as unknown[] | null) ?? []).length} action(s) to approve`;
    return {
      id: row.id,
      kind: "agent_run",
      title,
      requestedBy: nameById.get(row.requested_by) ?? "",
      age: recheckAgeLabel(row.created_at),
    };
  });
}

/**
 * `workflow_run`s awaiting a human decision (rulings "Approvals union", M23).
 * Gate: `workflow.manage` + the `workflows` module (RLS itself allows admin
 * read too, but admins never author/approve the same flow, 07 §2.2).
 */
async function pendingWorkflowRunApprovals(ctx: TenantContext): Promise<ApprovalRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workflow_runs")
    .select("id, cursor_node_id, created_at, graph, workflows!inner(name)")
    .eq("institution_id", ctx.institution.id)
    .eq("status", "awaiting_approval")
    .order("created_at", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const workflowName = (row.workflows as unknown as { name: string }).name;
    const nodes = ((row.graph as { nodes?: unknown[] } | null)?.nodes ?? []) as Array<{
      id: string;
      config?: Record<string, string>;
    }>;
    const prompt = nodes.find((node) => node.id === row.cursor_node_id)?.config?.prompt ?? "Approval needed";
    return {
      id: row.id,
      kind: "workflow_run",
      title: `${workflowName}: ${prompt}`,
      requestedBy: "Automation",
      age: recheckAgeLabel(row.created_at),
    };
  });
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
