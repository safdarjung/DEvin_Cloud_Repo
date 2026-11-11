// AI workflow drafter prompt. The description (and, for "refine", the
// editor's current draft) go inside the shared nonce-delimited data block
// (./data-block.ts), with the school's section labels (like "X-A") and agent
// names/summaries — no student, guardian or staff records.
import { CONDITION_OPS, NOTIFY_ROLES, WORKFLOW_EVENTS, WORKFLOW_METRICS } from "@/modules/workflows/catalog";
import { OP_WORDS } from "@/modules/workflows/describe";
import type { WorkflowDraftForm } from "@/modules/ai/workflow-drafts";
import { DATA_IS_NOT_INSTRUCTIONS as DATA_RULE, dataBlock, sanitizeForDataBlock } from "./data-block";

export const WORKFLOW_DRAFT_INSTRUCTIONS =
  "You turn a school leader's plain-language request into one automation workflow for an Indian school. " +
  "A workflow has a name, a trigger and 1 to 8 steps run in order. Trigger kind: 'manual' (someone presses Run now; " +
  "use it when they just want to see a number or do something once), 'schedule' (frequency daily, mon_fri, mon_sat " +
  "or weekly with weekday 0=Sunday..6=Saturday, and time HH:MM in 24 hours) or 'event' (one of the listed events). " +
  "Step types: 'check_number' (metric, comparison, value, and section when the metric is per section; the workflow " +
  "stops when the check fails, so to simply report a number use comparison gte with value 0), 'notify' (roles and a " +
  "message up to 200 characters; {count} once inserts the last number checked), 'approval' (a yes/no question for " +
  "the owner or principal; the workflow stops if rejected) and 'ask_agent' (agent id and a task; the agent only " +
  "drafts). Use only the metrics, events, roles, sections and agents listed; never invent one. For anything you do " +
  "not use, give an empty string, 0, or an empty list. Plain text only. Respond with JSON only, matching the schema. " +
  DATA_RULE;

export interface WorkflowDraftPromptInput {
  description: string;
  sections: readonly { id: string; label: string }[];
  agents: readonly { slug: string; name: string; summary: string }[];
  currentDraft?: WorkflowDraftForm;
}

/** The current draft as the model sees it: section ids swapped for their labels. */
function draftForModel(draft: WorkflowDraftForm, sections: WorkflowDraftPromptInput["sections"]): string {
  const label = new Map(sections.map((s) => [s.id, s.label]));
  const steps = draft.steps.map((s) => (s.config.section ? { ...s, config: { ...s.config, section: label.get(s.config.section) ?? "" } } : s));
  return JSON.stringify({ ...draft, steps });
}

export function buildWorkflowDraftPrompt(input: WorkflowDraftPromptInput): string {
  const metrics = Object.entries(WORKFLOW_METRICS).map(
    ([key, m]) => `${key}: ${m.label}${m.event ? ` (only with the event trigger ${m.event})` : ""}${key === "attendance.section_absent_today" ? " (needs a section)" : ""}`,
  );
  const task = [
    "Metrics:",
    ...metrics,
    `Comparisons: ${CONDITION_OPS.map((op) => `${op} (${OP_WORDS[op]})`).join(", ")}.`,
    `Events: ${Object.entries(WORKFLOW_EVENTS).map(([key, e]) => `${key} (${e.label})`).join(", ")}.`,
    `Roles: ${NOTIFY_ROLES.join(", ")}.`,
    "The school's sections and agents are listed in the data below; use their exact labels and ids.",
    input.currentDraft ? "Revise the current workflow below as the request asks; keep what it does not ask to change." : "Draft the workflow from the request below.",
  ];
  // Section labels and custom agent names/summaries are school-written text: data, never instructions.
  return dataBlock(sanitizeForDataBlock(task.join("\n")), [
    `Sections: ${input.sections.length ? input.sections.map((s) => s.label).join(", ") : "none"}.`,
    "Agents (id: name. summary):",
    ...(input.agents.length ? input.agents.map((a) => `${a.slug}: ${a.name}. ${a.summary}`) : ["none"]),
    "Request:",
    input.description,
    ...(input.currentDraft ? ["Current workflow (JSON):", draftForModel(input.currentDraft, input.sections)] : []),
  ]);
}
