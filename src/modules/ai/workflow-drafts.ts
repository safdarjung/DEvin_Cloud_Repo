// AI workflow drafter — request schema, the closed generation frame and the
// validator for api/ai/workflow-draft. The model fills an every-key-present
// frame whose choices are enums of the workflow catalog (metrics, events,
// comparisons, roles), the school's own section labels and its agents, so
// nothing outside them can come back. toWorkflowDraft then maps the frame
// onto the workflow form and validates it whole with the module's own form
// validator, graph parser and save schema: a bad draft is rejected, never
// partial. Persists nothing (rule 6): the editor shows the draft for review.
import { z } from "zod";
import { CONDITION_OPS, NOTIFY_ROLES, SECTION_METRICS, WORKFLOW_EVENTS, WORKFLOW_METRICS } from "@/modules/workflows/catalog";
import { cronFromPick, type ScheduleFrequency } from "@/modules/workflows/describe";
import { buildGraph, STEP_TYPES, validateWorkflowForm, type StepForm, type WorkflowForm } from "@/modules/workflows/form-graph";
import { parseGraph, stepCount } from "@/modules/workflows/graph";
import { WorkflowSaveSchema } from "@/modules/workflows/schemas";

export const WORKFLOW_DESCRIPTION_MAX = 1000;
export const WORKFLOW_DRAFT_MAX_STEPS = 8;

const institutionSlug = z.string().trim().min(1).max(100);
const config = z.record(z.string(), z.string().max(500));

/** The editor's working draft, sent for a "refine" request. Re-validated like any other output. */
export const WorkflowDraftFormSchema = z
  .object({
    name: z.string().max(80),
    trigger: z.object({ label: z.string().max(60), config }).strict(),
    steps: z.array(z.object({ type: z.enum(STEP_TYPES), label: z.string().max(60), config }).strict()).max(30),
  })
  .strict();
export type WorkflowDraftForm = z.infer<typeof WorkflowDraftFormSchema>;

export const WorkflowDraftRequestSchema = z
  .object({
    institutionSlug,
    description: z.string().trim().min(1).max(WORKFLOW_DESCRIPTION_MAX),
    currentDraft: WorkflowDraftFormSchema.optional(),
  })
  .strict();

export interface WorkflowDraftOptions {
  sections: readonly { id: string; label: string }[];
  agents: readonly { slug: string; name: string }[];
}

// Model-facing step kinds (plain words), mapped to the form's step types.
const GEN_STEP: Record<string, Exclude<StepForm["type"], "report">> = {
  check_number: "condition",
  notify: "notify",
  approval: "approval",
  ask_agent: "agent",
};
const FREQUENCIES = ["none", "daily", "mon_fri", "mon_sat", "weekly"] as const;
const TRIGGER_LABEL = { manual: "Run by hand", schedule: "On a schedule", event: "When something happens" } as const;

/** z.enum needs at least one value; an empty option list allows only "". */
const oneOf = (values: readonly string[]) => z.enum(["", ...new Set(values)] as [string, ...string[]]);

/** The frame the model fills. Built per request: sections and agents are the school's own. */
export function workflowDraftGenerationSchema(opts: WorkflowDraftOptions) {
  const step = z
    .object({
      type: z.enum(Object.keys(GEN_STEP) as [string, ...string[]]),
      label: z.string().trim().max(60),
      metric: oneOf(Object.keys(WORKFLOW_METRICS)),
      comparison: oneOf(CONDITION_OPS),
      value: z.number().int().min(0).max(999_999),
      section: oneOf(opts.sections.map((s) => s.label)),
      roles: z.array(z.enum(NOTIFY_ROLES)).max(NOTIFY_ROLES.length),
      message: z.string().trim().max(200),
      question: z.string().trim().max(120),
      agent: oneOf(opts.agents.map((a) => a.slug)),
      task: z.string().trim().max(500),
    })
    .strict();
  return z
    .object({
      name: z.string().trim().max(80),
      trigger: z
        .object({
          kind: z.enum(["manual", "schedule", "event"]),
          frequency: z.enum(FREQUENCIES),
          weekday: z.number().int().min(0).max(6),
          // No regex here: a JSON-schema `pattern` breaks Ollama's format grammar; toTrigger checks HH:MM.
          time: z.string().trim().max(5),
          event: oneOf(Object.keys(WORKFLOW_EVENTS)),
        })
        .strict(),
      steps: z.array(step).max(WORKFLOW_DRAFT_MAX_STEPS),
    })
    .strict();
}
type Generated = z.infer<ReturnType<typeof workflowDraftGenerationSchema>>;

function toTrigger(t: Generated["trigger"]): WorkflowForm["trigger"] | null {
  if (t.kind === "manual") return { label: TRIGGER_LABEL.manual, config: { kind: "manual" } };
  if (t.kind === "event") return t.event ? { label: TRIGGER_LABEL.event, config: { kind: "event", event: t.event } } : null;
  if (t.frequency === "none" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)) return null;
  const cron = cronFromPick({ frequency: t.frequency as ScheduleFrequency, day: t.weekday, time: t.time });
  return { label: TRIGGER_LABEL.schedule, config: { kind: "schedule", cron } };
}

function toStep(g: Generated["steps"][number], sectionId: Map<string, string>): StepForm {
  const type = GEN_STEP[g.type]!;
  const label = g.label || { condition: "Check a number", notify: "Notify", approval: "Wait for approval", agent: "Ask an agent" }[type];
  switch (type) {
    case "condition": {
      const perSection = (SECTION_METRICS as readonly string[]).includes(g.metric);
      const section = perSection ? sectionId.get(g.section) : undefined;
      return { type, label, config: { metric: g.metric, op: g.comparison, value: String(g.value), ...(section ? { section } : {}) } };
    }
    case "notify":
      return { type, label, config: { audience: "roles", roles: g.roles.join(","), message: g.message } };
    case "approval":
      return { type, label, config: { prompt: g.question } };
    case "agent":
      return { type, label, config: { agent: g.agent, task: g.task } };
  }
}

export type WorkflowDraftResult = { ok: true; name: string; form: WorkflowForm } | { ok: false };

/** Model output -> a workflow form, validated whole; anything outside the catalog or this school rejects the draft. */
export function toWorkflowDraft(raw: unknown, opts: WorkflowDraftOptions): WorkflowDraftResult {
  const gen = workflowDraftGenerationSchema(opts).safeParse(raw);
  if (!gen.success || gen.data.steps.length === 0) return { ok: false };
  const trigger = toTrigger(gen.data.trigger);
  if (!trigger) return { ok: false };

  const sectionId = new Map(opts.sections.map((s) => [s.label, s.id]));
  const form: WorkflowForm = { trigger, steps: gen.data.steps.map((s) => toStep(s, sectionId)) };
  const name = gen.data.name || "New workflow";

  if (Object.keys(validateWorkflowForm(name, form)).length > 0) return { ok: false };
  const graph = buildGraph(form);
  if (!parseGraph(graph).ok || stepCount(graph.nodes) === 0) return { ok: false };
  if (!WorkflowSaveSchema.safeParse({ name, ...graph }).success) return { ok: false };
  return { ok: true, name, form };
}
