import {
  AgentDefinition,
  AgentRun,
  Workflow,
  WorkflowRun,
  WorkflowNode,
  GraphEdge,
  RiskClass,
} from "../types";
import { FixtureOpts, rng, isoDate, addDays } from "./prng";

const AGENT_NAMES = [
  "attendance-followup",
  "fee-reminder-drafter",
  "timetable-checker",
  "admissions-replier",
  "report-remark-drafter",
  "data-quality-auditor",
  "briefing-writer",
  "substitution-planner",
];

const TOOLS_SETS = [
  ["email-send", "student-query"],
  ["email-draft", "schedule-sync"],
  ["calendar-check", "conflict-detect"],
  ["email-reply", "crm-lookup"],
  ["markdown-draft", "student-data"],
  ["data-audit", "anomaly-detect"],
  ["report-generate", "markdown-render"],
  ["substitute-match", "notification-send"],
];

const PERMISSIONS_SETS = [
  ["attendance.read", "email.send"],
  ["fee.read", "email.draft"],
  ["timetable.read", "schedule.read"],
  ["admissions.read", "email.reply"],
  ["reports.read", "student.read"],
  ["data.audit", "student.read"],
  ["reports.read", "insights.read"],
  ["staff.read", "timetable.read"],
];

const RISK_CLASSES: RiskClass[] = [
  "read_only",
  "low_risk_reversible",
  "user_confirmed",
  "human_approved",
];

const TASK_TEMPLATES = [
  "Follow up on absent students for Section %s",
  "Draft fee reminder emails for outstanding accounts",
  "Check %s timetable for scheduling conflicts",
  "Reply to pending admissions inquiries",
  "Generate end-term remarks for %s",
  "Audit data completeness in %s",
  "Write daily briefing for leadership",
  "Find substitute teacher for %s on %s",
];

const SECTIONS = ["VI-A", "VII-B", "VIII-A", "IX-B", "X-A", "XI-A", "XII-A"];

const STAFF_NAMES = ["Priya S.", "Rajesh K.", "Anjali M.", "Vikram P."];

const LOG_MESSAGES = [
  "Started processing",
  "Retrieved student records",
  "Generated content draft",
  "Ready for approval",
  "Completed successfully",
  "Awaiting user confirmation",
];

const TRIGGER_TYPES = ["schedule", "schedule", "event", "event", "manual"] as const;

const NOTIFICATION_METHODS = ["email", "sms", "in_app"];

export function agentDefinitions(opts: FixtureOpts): AgentDefinition[] {
  const r = rng(opts.seed);
  return AGENT_NAMES.map((name, i) => ({
    id: r.id("ag", i),
    institution_id: opts.institutionId,
    created_at: isoDate(addDays(opts.now, -30 - r.int(0, 60))),
    updated_at: isoDate(addDays(opts.now, -1 - r.int(0, 7))),
    slug: name,
    name: name
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" "),
    role_description: `Agent for ${name} with automated task execution`,
    tools: TOOLS_SETS[i],
    permissions: PERMISSIONS_SETS[i],
    model_tier: r.pick(["local", "cloud_small", "cloud_large"]),
    max_risk_class: r.pick(["read_only", "low_risk_reversible", "user_confirmed", "human_approved"]),
    is_enabled: r.chance(0.9),
    quality_score: r.chance(0.8) ? r.int(65, 98) : null,
    cost_paise_30d: r.int(100, 5000),
    runs_30d: r.int(2, 20),
    error_rate_pct: r.int(0, 15),
  }));
}

export function agentRuns(opts: FixtureOpts): AgentRun[] {
  const r = rng((opts.seed ?? 7) ^ 0x12345);
  const agents = agentDefinitions(opts);
  const runs: AgentRun[] = [];

  for (let i = 0; i < 30; i++) {
    const agent = agents[i % agents.length];
    const daysAgo = r.int(0, 13);
    const startedAt = addDays(opts.now, -daysAgo);
    const durationMinutes = r.int(1, 120);
    const finishedAt = r.chance(0.9)
      ? addDays(startedAt, durationMinutes / (24 * 60))
      : null;

    // 3 awaiting_approval, rest mixed
    let status: "queued" | "running" | "awaiting_approval" | "done" | "failed" | "rejected" = r.pick([
      "done",
      "done",
      "done",
      "done",
      "running",
      "running",
      "done",
      "failed",
      "rejected",
    ]);
    if (i < 3) status = "awaiting_approval";

    const taskIdx = r.int(0, TASK_TEMPLATES.length - 1);
    const taskTemplate = TASK_TEMPLATES[taskIdx];
    let task = taskTemplate;
    if (taskTemplate.includes("%s")) {
      const replacements = [
        r.pick(SECTIONS),
        isoDate(opts.now),
        r.pick(STAFF_NAMES),
      ];
      task = taskTemplate.replace(/%s/g, () => replacements.shift() || "");
    }

    const logLines = r.int(3, 6);
    const log = [];
    for (let j = 0; j < logLines; j++) {
      log.push({
        at: isoDate(addDays(startedAt, (j / logLines) * (durationMinutes / (24 * 60)))),
        level: r.pick(["info", "info", "info", "warn", "error"] as const),
        text: LOG_MESSAGES[j % LOG_MESSAGES.length],
      });
    }

    runs.push({
      id: r.id("ar", i),
      institution_id: opts.institutionId,
      created_at: isoDate(startedAt),
      updated_at: isoDate(finishedAt || opts.now),
      agent_id: agent.id,
      workflow_run_id: r.chance(0.6) ? r.id("wr", r.int(0, 7)) : null,
      task,
      risk_class: r.pick(RISK_CLASSES),
      status,
      started_at: isoDate(startedAt),
      finished_at: finishedAt ? isoDate(finishedAt) : null,
      approver: status === "awaiting_approval" ? r.pick(STAFF_NAMES) : null,
      cost_paise: r.int(10, 500),
      summary: `${agent.name}: ${task.slice(0, 50)}...`,
      log,
    });
  }

  return runs;
}

export function workflows(opts: FixtureOpts): Workflow[] {
  const r = rng((opts.seed ?? 7) ^ 0x23456);
  const workflows: Workflow[] = [];

  for (let w = 0; w < 5; w++) {
    const nodeCount = r.int(6, 9);
    const nodes: WorkflowNode[] = [];
    const edges: GraphEdge[] = [];

    // Trigger node
    nodes.push({
      id: r.id("wn", 0),
      type: "trigger",
      label: `${r.pick(TRIGGER_TYPES)} trigger`,
      config: { schedule: "daily" },
      x: 0,
      y: 0,
    });

    // Middle nodes (mix of agent, condition, approval)
    // Ensure at least one approval node per workflow
    const hasApprovalAlready = false;
    for (let i = 1; i < nodeCount - 1; i++) {
      let nodeType: "agent" | "condition" | "approval" | "notify";
      if (i === Math.floor((nodeCount - 2) / 2) && !hasApprovalAlready) {
        // Force approval node in the middle
        nodeType = "approval";
      } else {
        nodeType = r.pick(["agent", "agent", "condition", "approval", "notify"]);
      }

      const x = i * 220;
      const y = r.pick([0, -60, 60]);

      nodes.push({
        id: r.id("wn", i),
        type: nodeType,
        label: `${nodeType} ${i}`,
        config:
          nodeType === "agent"
            ? { agent: AGENT_NAMES[i % AGENT_NAMES.length] }
            : nodeType === "approval"
            ? { approver_role: "principal" }
            : nodeType === "notify"
            ? { method: r.pick(NOTIFICATION_METHODS) }
            : {},
        x,
        y,
      });
    }

    // End node
    nodes.push({
      id: r.id("wn", nodeCount - 1),
      type: "end",
      label: "end",
      config: {},
      x: (nodeCount - 1) * 220,
      y: 0,
    });

    // Edges: linear flow trigger → ... → end, with branches for approval
    for (let i = 0; i < nodeCount - 1; i++) {
      edges.push({
        source: nodes[i].id,
        target: nodes[i + 1].id,
        label: "success",
      });
    }

    workflows.push({
      id: r.id("wf", w),
      institution_id: opts.institutionId,
      created_at: isoDate(addDays(opts.now, -30 - r.int(0, 30))),
      updated_at: isoDate(addDays(opts.now, -1 - r.int(0, 7))),
      name: `Workflow ${w + 1}`,
      version: 1,
      status: r.pick(["active", "active", "draft", "paused"]),
      trigger: {
        type: r.pick(TRIGGER_TYPES),
        config: "every day at 06:00",
      },
      nodes,
      edges,
      created_by: r.pick(STAFF_NAMES),
    });
  }

  return workflows;
}

export function workflowRuns(opts: FixtureOpts): WorkflowRun[] {
  const r = rng((opts.seed ?? 7) ^ 0x34567);
  const workflowList = workflows(opts);
  const runs: WorkflowRun[] = [];

  for (let i = 0; i < 8; i++) {
    const workflow = workflowList[i % workflowList.length];
    const daysAgo = r.int(0, 13);
    const startedAt = addDays(opts.now, -daysAgo);
    const finishedAt = r.chance(0.8)
      ? addDays(startedAt, r.int(5, 120) / (24 * 60))
      : null;

    const steps = workflow.nodes.map((node, idx) => {
      let status: "pending" | "running" | "done" | "failed" | "skipped";
      if (finishedAt) {
        status = r.pick(["done", "done", "done", "failed", "skipped"]);
      } else if (idx <= r.int(1, workflow.nodes.length - 1)) {
        status = r.pick(["running", "done", "done"]);
      } else {
        status = "pending";
      }

      return {
        node_id: node.id,
        status,
        at: isoDate(addDays(startedAt, (idx / workflow.nodes.length) * 0.1)),
        note: status === "failed" ? "Approval declined" : undefined,
      };
    });

    runs.push({
      id: r.id("wr", i),
      institution_id: opts.institutionId,
      created_at: isoDate(startedAt),
      updated_at: isoDate(finishedAt || opts.now),
      workflow_id: workflow.id,
      status: finishedAt ? r.pick(["done", "done", "failed"]) : r.pick(["running", "awaiting_approval"]),
      started_at: isoDate(startedAt),
      finished_at: finishedAt ? isoDate(finishedAt) : null,
      steps,
    });
  }

  return runs;
}
