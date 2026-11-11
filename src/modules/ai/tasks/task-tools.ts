import "server-only";
// Orb task bridge — the chat tools (design §3). Selection costs no model step:
// the caller's enabled tasks are ranked against the last two user texts with
// the tool budget's own scoring, and the top 5 compact signatures ride in the
// system prompt inside a nonce-delimited <tasks-…> block. `propose_task` opens
// an approval card (TaskProposalOutput, read by the browser); the model only
// gets back "Card shown: <label>". `find_task` is the fallback, like more_tools.
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { AppError } from "@/lib/actions/result";
import type { TenantContext } from "@/lib/auth/types";
import { groupScores, queryTerms, type ToolGroup } from "@/lib/ai/tool-budget";
import type { OrbGroupId } from "@/modules/ai/components/orb/orb-groups";
import { actionJsonSchema } from "./derive";
import { EXPANDERS } from "./expanders";
import { createProposal, MAX_PROPOSALS, provenanceFor } from "./proposals";
import { taskSignature } from "./signature";
import { classifiedTask, taskActionMeta } from "./classified";
import { listEnabledTasks, type EnabledTask } from "./state";
import type { OrbMode, TaskProposalOutput } from "./types";

export const PROPOSE_TOOL = "propose_task";
export const FIND_TOOL = "find_task";
/** Signatures in the system prompt per message (design §3, about 35 tokens each). */
export const MAX_SIGNATURES = 5;

export interface ProposeTaskInput {
  task: string;
  values?: Record<string, unknown>;
  /** 1-based number of an earlier propose_task call in this turn that this card waits for. */
  after?: number;
}

export interface FindTaskInput {
  query: string;
}

export interface TaskToolsOptions {
  ctx: TenantContext;
  nonce: string;
  /** Latest user text first, then the one before. */
  texts: readonly string[];
  /** Orb tab and group the person is in: a ranking preference, never a filter. */
  mode?: OrbMode;
  groupId?: OrbGroupId;
  /** A task the person clicked: exactly that signature is offered. */
  taskHint?: string;
  /** Guardian chat: the verified child every studentId is pinned to. */
  childId?: string;
  /** Registered queries this turn has read (for the provenance badge). */
  readSources?: () => readonly string[];
}

export interface TaskTools {
  tools: ToolSet;
  /** System prompt block (empty when no task is on). */
  system: string;
  /** Actions whose signatures are in the block, best first. */
  offered: readonly string[];
  /** `draft_<action>` tools an enabled task replaces (the card supersedes the old draft). */
  supersedes: readonly string[];
}

/** The chat's tools plus the task tools, minus the drafts the task cards replace. */
export function withTaskTools(tools: ToolSet, tasks: TaskTools): ToolSet {
  return { ...Object.fromEntries(Object.entries(tools).filter(([name]) => !tasks.supersedes.includes(name))), ...tasks.tools };
}

/** The task's one-line signature; register tasks show their intent form instead of a roster (design C3). */
export function signatureFor(action: string): string {
  const task = classifiedTask(action);
  const meta = taskActionMeta(action);
  if (!task || !meta) return action;
  const expander = EXPANDERS[action];
  return expander ? `${action}: ${task.label} | ${expander.signature}` : taskSignature(action, task, actionJsonSchema(meta));
}

// Mode and group stay out of the matched words: they are a preference applied below, never a filter.
const asGroups = (tasks: readonly EnabledTask[]): ToolGroup[] => tasks.map((t) => ({ key: t.action, label: t.label, description: "", tools: [t.action] }));

/** "school" sits in schoolLabs.* names but in almost every request ("for the whole school"). */
const NOISE = new Set(["school"]);
/** The orb tab and section the person is in: a modest boost between matching tasks. */
export const PREFERENCE_BOOST = 1.25;

export interface TaskPreference {
  mode?: OrbMode;
  groupId?: OrbGroupId;
}

/** Tasks ranked against the texts (latest weighs double), best first; zero scores dropped; the preferred mode/group boosts, ties keep catalog order. */
export function rankTasks(tasks: readonly EnabledTask[], texts: readonly string[], prefer: TaskPreference = {}): EnabledTask[] {
  const groups = asGroups(tasks);
  const perText = texts.map((text, i) => ({ scores: groupScores(groups, queryTerms(text).filter((w) => !NOISE.has(w))), weight: i === 0 ? 2 : 1 }));
  const boost = (t: EnabledTask) => (t.mode === prefer.mode ? PREFERENCE_BOOST : 1) * (t.groupId === prefer.groupId ? PREFERENCE_BOOST : 1);
  return tasks
    .map((task, index) => ({ task, index, score: boost(task) * perText.reduce((s, t) => s + t.weight * (t.scores[index] ?? 0), 0) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.task);
}

function tasksBlock(nonce: string, actions: readonly string[]): string {
  return [
    `Tasks you can propose are listed inside <tasks-${nonce}> tags (name: label | field:kind, "!" = required).`,
    "- To do one, call propose_task right away with its name and only the values the person gave. Do not look anything up first:",
    "  pass names, sections and dates as the person said them; the server finds the records and fills class rosters. Leave out what you do not know.",
    "- Put each thing the person named in its field: a class such as VIII-B in classSectionId; dates as YYYY-MM-DD, today or tomorrow.",
    "- The person reviews and approves every card. Never say a task was done; say a card is ready.",
    "- For several steps, call propose_task once per step and set after to the earlier call's number (1 = first).",
    "- Asked to do something no listed task fits? Call find_task with the person's words first. Only if it finds nothing say the app cannot,",
    "  and name a page only if navigate gives one.",
    `<tasks-${nonce}>`,
    ...actions.map(signatureFor),
    `</tasks-${nonce}>`,
  ].join("\n");
}

export function buildTaskTools(opts: TaskToolsOptions): TaskTools {
  const { ctx } = opts;
  const all = listEnabledTasks(ctx);
  if (all.length === 0) return { tools: {}, system: "", offered: [], supersedes: [] };
  // Every enabled task is a candidate; only taskState (control centre) removes one. The orb tab is a preference.
  const hinted = opts.taskHint ? all.find((t) => t.action === opts.taskHint) : undefined;
  const offered = hinted ? [hinted.action] : rankTasks(all, opts.texts, { mode: opts.mode, groupId: opts.groupId }).slice(0, MAX_SIGNATURES).map((t) => t.action);
  const enabled = new Set(all.map((t) => t.action));
  const created: string[] = [];

  const propose = tool({
    description: "Show the person an approval card for one listed task, prefilled with the values you know. Nothing runs until they approve.",
    inputSchema: z.object({
      task: z.string().max(80).describe("Task name from the tasks list"),
      values: z.record(z.string(), z.unknown()).optional().describe("Field values; names or text for ref fields"),
      after: z.number().int().min(1).max(MAX_PROPOSALS).optional().describe("Earlier propose_task call this step waits for"),
    }),
    execute: async ({ task, values, after }: ProposeTaskInput): Promise<TaskProposalOutput | string> => {
      if (created.length >= MAX_PROPOSALS) return `At most ${MAX_PROPOSALS} cards per answer. Ask the person to approve these first.`;
      if (!enabled.has(task)) return "That task is not available. Call find_task to see what is.";
      const dependsOn = after !== undefined ? created[after - 1] : undefined;
      if (after !== undefined && !dependsOn) return `There is no card number ${after} yet.`;
      try {
        const output = await createProposal(ctx, {
          action: task,
          values: values ?? {},
          dependsOn,
          childId: opts.childId,
          provenance: provenanceFor(opts.readSources?.() ?? []),
          source: "model",
        });
        created.push(output.proposalId);
        return output;
      } catch (err) {
        if (err instanceof AppError) return `Could not show that card: ${err.message}`;
        throw err;
      }
    },
    // Resolved names and ids go to the browser only, never back to the model (design §3).
    toModelOutput: ({ output }) => ({
      type: "text",
      value: typeof output === "string" ? output : `Card shown: ${output.view.label}. It is card number ${created.indexOf(output.proposalId) + 1}.`,
    }),
  });

  const find = tool({
    description: "Search the tasks you can propose when none listed fits; returns their signatures.",
    inputSchema: z.object({ query: z.string().min(1).max(100) }),
    execute: async ({ query }: FindTaskInput): Promise<string> => {
      const hits = rankTasks(all, [query]).slice(0, MAX_SIGNATURES);
      return hits.length ? hits.map((t) => signatureFor(t.action)).join("\n") : "No task matches. Answer in words instead.";
    },
  });

  const supersedes = all.map((t) => `draft_${t.action.replace(/\./g, "_")}`);
  return { tools: { [PROPOSE_TOOL]: propose, [FIND_TOOL]: find }, system: tasksBlock(opts.nonce, offered), offered, supersedes };
}
