import type { SeedContext } from "../lib/context.ts";
import { uuidV5 } from "../lib/ids.ts";
import { demoUsers, insertOnce, isoAt, isoDay, dayStart, sectionRng, pick } from "../lib/util.ts";
import { runWorkflow, type EnginePorts, type EngineResult } from "../../../src/modules/workflows/engine.ts";
import { parseGraph } from "../../../src/modules/workflows/graph.ts";
import type { WorkflowMetricKey } from "../../../src/modules/workflows/catalog.ts";
import { WORKFLOW_TEMPLATES } from "../../../src/modules/workflows/templates.ts";

// ~45 runs over the last 30 days across the 5 seeded workflows. Every step list is produced by
// the real engine (`runWorkflow`) with deterministic fake ports, so statuses and notes match
// what the job runner would write. The fee-reminder workflow is the only template with an
// approval node: its recent Monday runs (plus one manual run) wait for approval and feed the
// dashboard approvals queue; older ones were approved or rejected.

const ENGINE_VERSION = "workflows_v1";
const FAILURE_KEYS = new Set(["assignment_reminder:3", "admissions_follow_up:5", "exam_reminder:1", "absence_follow_up:8"]);

interface PlannedRun {
  templateKey: string;
  triggerKind: "schedule" | "event" | "manual";
  triggerKey: string;
  day: number; // offset from today, <= 0
  hour: number;
  minute: number;
  fail: boolean;
  /** fee_reminder only: what happened at the approval step. */
  approval?: "waiting" | "approved" | "rejected";
  requestedBy?: "accountant";
}

function lastMonday(offsetWeeks: number): number {
  const dow = dayStart(0).getUTCDay(); // 0 = Sunday
  return -((dow + 6) % 7) - offsetWeeks * 7;
}

function plan(): PlannedRun[] {
  const runs: PlannedRun[] = [];
  for (let i = 0; i < 12; i++) {
    const day = -(1 + i * 2);
    runs.push({ templateKey: "assignment_reminder", triggerKind: "schedule", triggerKey: `${isoDay(day)}T16:00`, day, hour: 16, minute: 0, fail: FAILURE_KEYS.has(`assignment_reminder:${i}`) });
  }
  for (let i = 0; i < 10; i++) {
    const day = -(2 + i * 3);
    runs.push({ templateKey: "admissions_follow_up", triggerKind: "schedule", triggerKey: `${isoDay(day)}T10:00`, day, hour: 10, minute: 0, fail: FAILURE_KEYS.has(`admissions_follow_up:${i}`) });
  }
  for (let w = 0; w < 5; w++) {
    const day = lastMonday(w);
    if (day < -30) continue;
    runs.push({ templateKey: "exam_reminder", triggerKind: "schedule", triggerKey: `${isoDay(day)}T08:00`, day, hour: 8, minute: 0, fail: FAILURE_KEYS.has(`exam_reminder:${w}`) });
    const approval = w < 3 ? "waiting" : w === 3 ? "approved" : "rejected";
    runs.push({ templateKey: "fee_reminder", triggerKind: "schedule", triggerKey: `${isoDay(day)}T09:00`, day, hour: 9, minute: 0, fail: false, approval });
  }
  runs.push({ templateKey: "fee_reminder", triggerKind: "manual", triggerKey: `manual:fee-reminder:${isoDay(-1)}`, day: -1, hour: 15, minute: 20, fail: false, approval: "waiting", requestedBy: "accountant" });
  for (let i = 0; i < 12; i++) {
    const day = -(1 + i * 2) + (i % 3 === 0 ? -1 : 0);
    runs.push({ templateKey: "absence_follow_up", triggerKind: "event", triggerKey: `attendance.absences_submitted:${isoDay(day)}:${"ABCDEF"[i % 6]}`, day, hour: 11, minute: 5 + i, fail: FAILURE_KEYS.has(`absence_follow_up:${i}`) });
  }
  return runs;
}

export async function run(ctx: SeedContext): Promise<void> {
  const inst = ctx.institutionId;
  const rng = sectionRng("workflow-runs");
  const users = await demoUsers(ctx.sql, inst);
  const principal = users["principal"]!;
  const [{ overdue }] = await ctx.sql<{ overdue: number }[]>`
    select count(*)::int as overdue from public.invoices where institution_id = ${inst} and status in ('issued','part_paid') and due_on < current_date`;
  const staleEnquiries = await ctx.sql<{ n: number }[]>`select count(*)::int as n from public.enquiries where institution_id = ${inst} and status in ('new','contacted')`.catch(() => [{ n: 4 }]);

  const rows = [];
  for (const p of plan()) {
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === p.templateKey)!;
    const parsed = parseGraph({ nodes: template.nodes, edges: template.edges });
    if (!parsed.ok) throw new Error(`workflow-runs: ${p.templateKey} graph invalid`);
    const startedAt = isoAt(p.day, p.hour, p.minute);
    let tick = 0;
    const now = () => new Date(Date.parse(startedAt) + 1000 * tick++).toISOString();

    const metrics: Partial<Record<WorkflowMetricKey, number>> = {
      "attendance.session_absences": 2 + Math.floor(rng() * 6),
      "attendance.repeat_absentees": rng() < 0.55 ? 1 + Math.floor(rng() * 3) : 0,
      "assignments.missing_due_tomorrow": rng() < 0.8 ? 2 + Math.floor(rng() * 12) : 0,
      "exams.papers_next_7_days": rng() < 0.5 ? 6 * (1 + Math.floor(rng() * 4)) : 0,
      "finance.overdue_invoices": Math.max(1, overdue - Math.floor(rng() * 40)),
      "admissions.stale_enquiries": rng() < 0.7 ? 1 + Math.floor(rng() * (staleEnquiries[0]?.n ?? 4)) : 0,
    };
    // A failing run must reach its notify node, so force every condition true for it.
    if (p.fail) for (const k of Object.keys(metrics) as WorkflowMetricKey[]) metrics[k] = Math.max(metrics[k] ?? 0, 3);
    const ports: EnginePorts = {
      moduleOn: () => true,
      metric: async (key) => metrics[key] ?? 0,
      notify: async (cfg) => {
        if (p.fail) throw new Error("notification service unavailable");
        return cfg.audience === "roles" ? { status: "done", note: `Notified ${pick(rng, [2, 2, 3])}` } : { status: "done", note: "Fee reminders queued" };
      },
      report: async () => ({ status: "done", note: "Report queued" }),
      agent: async () => ({ status: "done", note: "Agent run queued" }),
      now,
    };

    let result: EngineResult = await runWorkflow(parsed.graph, { kind: "trigger" }, ports);
    let decidedAt: string | null = null;
    let decisionNote: string | null = null;
    if (result.status === "awaiting_approval" && (p.approval === "approved" || p.approval === "rejected")) {
      const decision = p.approval;
      decidedAt = isoAt(p.day, p.hour + 3, 10);
      decisionNote = decision === "approved" ? "Go ahead, mention the 15 Nov due date." : "Hold until the cheque batch is banked.";
      const resumed = await runWorkflow(parsed.graph, { kind: "resume", nodeId: result.cursorNodeId!, decision, lastValue: result.lastValue }, { ...ports, now });
      // The approval step is pushed once as `running` and once resolved; keep the earlier steps and the resumed ones.
      result = { ...resumed, steps: [...result.steps, ...resumed.steps] };
    }

    const terminal = result.status === "done" || result.status === "failed";
    const lastAt = result.steps[result.steps.length - 1]?.at ?? startedAt;
    rows.push({
      id: uuidV5("workflow-runs", `${template.key}:${p.triggerKey}`),
      institution_id: inst,
      workflow_id: uuidV5("workflows", `workflow:${template.key}`),
      workflow_version: 1,
      engine_version: ENGINE_VERSION,
      graph: { nodes: template.nodes, edges: template.edges },
      trigger_kind: p.triggerKind,
      trigger_key: p.triggerKey,
      requested_by: p.requestedBy ? users[p.requestedBy]! : null,
      status: result.status,
      started_at: startedAt,
      finished_at: terminal ? lastAt : null,
      steps: result.steps,
      cursor_node_id: result.status === "awaiting_approval" ? result.cursorNodeId : null,
      last_value: result.lastValue,
      decided_by: decidedAt ? principal : null,
      decided_at: decidedAt,
      decision_note: decisionNote,
      created_at: startedAt,
    });
  }
  await insertOnce(ctx.admin, "workflow_runs", rows);
}
