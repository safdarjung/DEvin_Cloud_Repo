import "server-only";
// M22-T5 — registry → scoped agent tools. Read tools are registered queries
// run as the caller (each keeps its own context, module, Zod and permission
// gates); proposal tools only record a proposal. Nothing executes during the
// model loop (D43, CLAUDE.md rule 6). Tool failures return strings, never
// throw, so the stream keeps going (same discipline as student-tools.ts).
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from "ai";
import { z } from "zod";
import { getQueryMeta, getRegisteredQueries } from "@/lib/actions/define-query";
import { getActionMeta, getRegisteredActions, type ActionMeta, type AnyAction } from "@/lib/actions/registry";
import type { ActionResult } from "@/lib/actions/result";
import { fitForModel } from "@/lib/ai/fit-for-model";
import { moneyForModel } from "@/lib/ai/tool-money";
import type { Permission } from "@/lib/auth/permissions";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { ACTION_RISK, scopedSpec, type AgentProposal, type AgentSlug, type CustomAgentScope, type RiskClass } from "./catalog";

export const MAX_PROPOSALS = 5;
export const MAX_PROPOSAL_INPUT_CHARS = 4_000;
export const MAX_TOOL_RESULT_CHARS = 4_000;

type ProposalRisk = AgentProposal["risk_class"];

export interface ProposalSink {
  add(p: Omit<AgentProposal, "status" | "error_code">): boolean;
  list(): AgentProposal[];
}

export function toolNameFor(name: string): string {
  return name.replace(/\./g, "_");
}

function inputTooLarge(input: unknown): boolean {
  return (JSON.stringify(input) ?? "").length > MAX_PROPOSAL_INPUT_CHARS;
}

export function createProposalSink(): ProposalSink {
  const proposals: AgentProposal[] = [];
  return {
    add(p) {
      if (proposals.length >= MAX_PROPOSALS || inputTooLarge(p.input)) return false;
      proposals.push({ ...p, status: "proposed", error_code: null });
      return true;
    },
    list() {
      return [...proposals];
    },
  };
}

// Dynamic, not static: manifest → agents/actions → executor → tools is a cycle.
async function loadManifests(): Promise<void> {
  await import("@/app/api/v1/query/all-queries");
  await import("@/app/api/v1/actions/all-actions");
}

function moduleOn(ctx: TenantContext, meta: ActionMeta): boolean {
  return meta.module !== undefined && isModuleEnabled(ctx, meta.module);
}

function isProposable(risk: RiskClass | undefined): risk is ProposalRisk {
  return risk === "low_risk_reversible" || risk === "user_confirmed" || risk === "human_approved";
}

// Describe only: raw model input reaches the query/action, whose own Zod parse
// is the single validation (same JSON Schema form as GET /api/v1/actions).
// Exported for draft-tools.ts (P1, phase3-tasks.md) — same describe-only
// contract, reused rather than copied.
export function describeInput(schema: z.ZodType) {
  const described = z.toJSONSchema(schema, { target: "draft-7", io: "input", unrepresentable: "any" });
  return jsonSchema<unknown>(dropFormatPatterns(described) as JSONSchema7);
}

// Zod spells `format: "uuid"`/`"date-time"` out again as a 160-480 char regex
// `pattern`; per tool that regex was most of the prompt tokens. The format
// keeps the hint for the model, and the query/action's own Zod parse still
// validates every input, so nothing is loosened. `$schema` is noise too.
function dropFormatPatterns(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropFormatPatterns);
  if (node === null || typeof node !== "object") return node;
  const { pattern, format } = node as { pattern?: unknown; format?: unknown };
  // String checks: a `properties` map may itself have fields named "pattern"/"format"/"$schema".
  const entries = Object.entries(node).filter(
    ([key, value]) => !(key === "$schema" && typeof value === "string") && !(key === "pattern" && typeof pattern === "string" && typeof format === "string"),
  );
  return Object.fromEntries(entries.map(([key, value]) => [key, dropFormatPatterns(value)]));
}

function readTool(
  ctx: TenantContext,
  name: string,
  description: string,
  query: AnyAction,
  meta: ActionMeta,
  nonce: string,
  onOk?: (query: string, params: unknown) => void,
) {
  return tool({
    description,
    inputSchema: describeInput(meta.schema),
    execute: async (input: unknown): Promise<string> => {
      try {
        const result = (await query(ctx.institution.slug, input)) as ActionResult<unknown>;
        if (!result.ok) return `Query failed: ${result.error.code}`;
        onOk?.(name, input);
        const payload = fitForModel(moneyForModel(name, result.data), MAX_TOOL_RESULT_CHARS);
        return `<data-${nonce}>${payload}</data-${nonce}>`;
      } catch (err) {
        console.error(`[agents] read tool "${name}" threw`, err);
        return "Query failed: internal";
      }
    },
  });
}

// Shared by buildAgentTools (M22) and the M24 assistant (T4): a registry
// name → description catalog becomes scoped read tools. Unregistered or
// unpermitted names are skipped, never thrown. `onOk` runs once a query
// returns ok, before the result is wrapped (assistant source logging).
export async function buildReadTools(
  ctx: TenantContext,
  catalog: Readonly<Record<string, string>>,
  nonce: string,
  onOk?: (query: string, params: unknown) => void,
): Promise<{ tools: ToolSet; registryNameOf: ReadonlyMap<string, string> }> {
  await loadManifests();
  const tools: ToolSet = {};
  const registryNameOf = new Map<string, string>();

  for (const [name, description] of Object.entries(catalog)) {
    const query = getRegisteredQueries().get(name);
    const meta = getQueryMeta().get(name);
    if (!query || !meta || typeof meta.permission !== "string") continue;
    if (!hasPermission(ctx, meta.permission) || !moduleOn(ctx, meta)) continue;
    tools[toolNameFor(name)] = readTool(ctx, name, description, query, meta, nonce, onOk);
    registryNameOf.set(toolNameFor(name), name);
  }

  return { tools, registryNameOf };
}

function proposalTool(sink: ProposalSink, action: string, description: string, risk: ProposalRisk, meta: ActionMeta) {
  return tool({
    description: `Propose for a person to review (nothing runs now): ${description}`,
    inputSchema: describeInput(meta.schema),
    execute: async (input: unknown): Promise<string> => {
      if (inputTooLarge(input)) return "Proposal too large.";
      return sink.add({ action, input, risk_class: risk }) ? "Proposed. A person will review it." : "Proposal limit reached.";
    },
  });
}

export async function buildAgentTools(
  ctx: TenantContext,
  slug: AgentSlug,
  sink: ProposalSink,
  nonce: string,
  scope?: CustomAgentScope,
): Promise<{ tools: ToolSet; registryNameOf: ReadonlyMap<string, string> }> {
  await loadManifests();
  const spec = scopedSpec(slug, scope);
  const { tools: readTools, registryNameOf: readRegistryNameOf } = await buildReadTools(ctx, spec.tools, nonce);
  const tools: ToolSet = { ...readTools };
  const registryNameOf = new Map<string, string>(readRegistryNameOf);

  // Permission is not checked here: execution goes through the action registry, which re-checks it.
  for (const [name, description] of Object.entries(spec.actions)) {
    const risk = ACTION_RISK[name];
    const meta = getActionMeta().get(name);
    if (!getRegisteredActions().has(name) || !meta || !isProposable(risk) || !moduleOn(ctx, meta)) continue;
    const toolName = `propose_${toolNameFor(name)}`;
    tools[toolName] = proposalTool(sink, name, description, risk, meta);
    registryNameOf.set(toolName, name);
  }

  return { tools, registryNameOf };
}

export async function agentPermissions(slug: AgentSlug, scope?: CustomAgentScope): Promise<Permission[]> {
  await loadManifests();
  const spec = scopedSpec(slug, scope);
  const perms = [
    ...Object.keys(spec.tools).map((name) => getQueryMeta().get(name)?.permission),
    ...Object.keys(spec.actions).map((name) => getActionMeta().get(name)?.permission),
  ].filter((p): p is Permission => typeof p === "string");
  return [...new Set(perms)].sort();
}
