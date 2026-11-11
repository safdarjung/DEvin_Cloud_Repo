// Pure mapping between the workflow form (trigger + ordered steps) and the stored node/edge graph.
// Shape: trigger -> steps -> end. A condition's `false` and an approval's `rejected` branch go to a second end node.
// Relative .ts imports only (unit-testable under plain node).
import { CronSchema } from "../reports/schemas.ts";
import { SECTION_METRICS } from "./catalog.ts";
import type { GraphEdge, WorkflowNode } from "./schemas.ts";

export const STEP_TYPES = ["condition", "notify", "agent", "approval", "report"] as const;
export type StepType = (typeof STEP_TYPES)[number];
export interface StepForm {
  type: StepType;
  label: string;
  config: Record<string, string>;
}
export interface WorkflowForm {
  trigger: { label: string; config: Record<string, string> };
  steps: StepForm[];
}

const branchLabel = (t: string): GraphEdge["label"] => (t === "condition" ? "true" : t === "approval" ? "approved" : undefined);
const edge = (source: string, target: string, label?: GraphEdge["label"]): GraphEdge => (label ? { source, target, label } : { source, target });

export function buildGraph(form: WorkflowForm): { nodes: WorkflowNode[]; edges: GraphEdge[] } {
  const nodes: WorkflowNode[] = [{ id: "t", type: "trigger", label: form.trigger.label, config: form.trigger.config }];
  const edges: GraphEdge[] = [];
  let prev = { id: "t", type: "trigger" as string };
  let needsSecondEnd = false;
  form.steps.forEach((s, i) => {
    const id = `s${i + 1}`;
    nodes.push({ id, type: s.type, label: s.label, config: s.config });
    edges.push(edge(prev.id, id, branchLabel(prev.type)));
    if (s.type === "condition" || s.type === "approval") {
      needsSecondEnd = true;
      edges.push(edge(id, "e2", s.type === "condition" ? "false" : "rejected"));
    }
    prev = { id, type: s.type };
  });
  nodes.push({ id: "e", type: "end", label: "End", config: {} });
  edges.push(edge(prev.id, "e", branchLabel(prev.type)));
  if (needsSecondEnd) nodes.push({ id: "e2", type: "end", label: "End", config: {} });
  return { nodes, edges };
}

function signature(nodes: { id: string; type: string; label: string; config: unknown }[], edges: GraphEdge[]): string[] {
  const sig = new Map(nodes.map((n) => [n.id, `${n.type}|${n.label}|${JSON.stringify(Object.entries(n.config as object).sort())}`]));
  return [...nodes.map((n) => sig.get(n.id)!), ...edges.map((e) => `${sig.get(e.source)}>${e.label ?? ""}>${sig.get(e.target)}`)].sort();
}

/** Reads a stored graph back into the form; null when it is not the form's shape (edit those elsewhere). */
export function formFromGraph(nodes: WorkflowNode[], edges: GraphEdge[]): WorkflowForm | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const trigger = nodes.find((n) => n.type === "trigger");
  if (!trigger) return null;
  const steps: StepForm[] = [];
  let cur = trigger;
  for (let guard = 0; guard < nodes.length; guard++) {
    const main = edges.find((e) => e.source === cur.id && (e.label === undefined || e.label === "true" || e.label === "approved"));
    const next = main && byId.get(main.target);
    if (!next || next.type === "end") break;
    if (!(STEP_TYPES as readonly string[]).includes(next.type)) return null;
    steps.push({ type: next.type as StepType, label: next.label, config: next.config });
    cur = next;
  }
  const form: WorkflowForm = { trigger: { label: trigger.label, config: trigger.config }, steps };
  const rebuilt = buildGraph(form);
  return JSON.stringify(signature(rebuilt.nodes, rebuilt.edges)) === JSON.stringify(signature(nodes, edges)) ? form : null;
}

export type FormErrors = Record<string, string[]>;

function stepFieldErrors(s: StepForm): Record<string, string> {
  const c = s.config;
  const out: Record<string, string> = {};
  if (!s.label.trim()) out.label = "Give the step a name.";
  switch (s.type) {
    case "condition":
      if (!c.metric) out.metric = "Pick a number to check.";
      else if ((SECTION_METRICS as readonly string[]).includes(c.metric) && !c.section) out.section = "Pick a section.";
      if (!c.op) out.op = "Pick a comparison.";
      if (!/^[0-9]{1,6}$/.test(c.value ?? "")) out.value = "Enter a whole number (0 or more).";
      break;
    case "notify":
      if (c.audience === "roles") {
        if (!c.roles) out.roles = "Pick at least one role.";
        if (!c.message?.trim()) out.message = "Write the message.";
        else if (c.message.split("{count}").length > 2) out.message = "Use {count} at most once.";
      }
      break;
    case "approval":
      if (!c.prompt?.trim()) out.prompt = "Write the question for the approver.";
      break;
    case "agent":
      if (!c.agent) out.agent = "Pick an agent.";
      if (!c.task?.trim()) out.task = "Write the task for the agent.";
      break;
    case "report":
      if (!c.scheduledReportId) out.scheduledReportId = "Pick a scheduled report.";
      break;
  }
  return out;
}

/** Inline field errors before saving, keyed `name`, `trigger.cron`, `steps.<i>.<field>`. Zero steps is allowed (empty draft). */
export function validateWorkflowForm(name: string, form: WorkflowForm): FormErrors {
  const errors: FormErrors = {};
  if (!name.trim()) errors.name = ["Give the workflow a name."];
  if (form.trigger.config.kind === "schedule" && !CronSchema.safeParse(form.trigger.config.cron ?? "").success) {
    errors["trigger.cron"] = ["Pick when it runs."];
  }
  form.steps.forEach((s, i) => {
    for (const [field, message] of Object.entries(stepFieldErrors(s))) errors[`steps.${i}.${field}`] = [message];
  });
  return errors;
}

/** Server graph errors ("node s2: …") onto the step they belong to (form node ids are s1..sN); `graph` keeps the full list. */
export function stepErrorsFromGraph(errors: string[]): FormErrors {
  const out: FormErrors = { graph: errors };
  for (const e of errors) {
    const m = /^node s(\d+): (.+)$/.exec(e);
    if (m) (out[`steps.${Number(m[1]) - 1}`] ??= []).push(m[2]!);
  }
  return out;
}
