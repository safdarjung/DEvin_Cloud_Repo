"use server";

// M22-T7 — agent.run / agent.definition.setEnabled (rulings "Execution",
// "Writes are server-only", "Log"). Mirrors timetable/actions.ts's
// defineAction + throwMapped style. `agent_runs`/`agent_definitions` grant
// no authenticated insert/update beyond `is_enabled` (07 §4, 20261028000095)
// — every write below but the `is_enabled` toggle goes through
// `agentsAdmin()`, always institution_id from `ctx`, always after this
// action's own module/permission/Zod gate has already run.
import { defineAction } from "@/lib/actions/define-action";
import { AppError, mapSqlError } from "@/lib/actions/result";
import { audit } from "@/lib/audit";
import { hasPermission } from "@/lib/auth/require";
import type { TenantContext } from "@/lib/auth/types";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/db/types";
import {
  AGENT_CATALOG_VERSION,
  canDecideRun,
  isAgentSlug,
  type AgentLogEntry,
  type AgentProposal,
  type AgentSlug,
  type CustomAgentRun,
  type RiskClass,
} from "@/modules/agents/catalog";
import { executeAgentRun, executeProposals, logEntry, type AgentRunOutcome } from "@/modules/agents/executor";
import { agentsAdmin, ensureAgentDefinitions } from "@/modules/agents/service-role";
import {
  ArchiveCustomAgentSchema,
  CreateCustomAgentSchema,
  DecideAgentRunSchema,
  RunAgentSchema,
  SetAgentEnabledSchema,
  UpdateCustomAgentSchema,
  type CreateCustomAgentInput,
  type DecideAgentRunInput,
  type RunAgentInput,
  type SetAgentEnabledInput,
  type UpdateCustomAgentInput,
} from "@/modules/agents/schemas";

const RUN_NOT_FINISHED = "The agent run stopped before it finished.";
// 0095's check: log jsonb array length <= 100.
const MAX_LOG_ENTRIES = 100;

function throwMapped(error: unknown): never {
  const mapped = mapSqlError(error);
  if (mapped.ok) throw new AppError("internal", "Unexpected error.");
  throw new AppError(mapped.error.code, mapped.error.message, mapped.error.fieldErrors);
}

type UserClient = Awaited<ReturnType<typeof createClient>>;

// Catalog rows carry only slug/is_enabled; custom rows (0134) also carry
// their base, stored subset and instructions.
const DEFINITION_COLUMNS = "id, slug, is_enabled, base_slug, tools, actions, instructions, archived_at";

interface DefinitionRow {
  slug: string;
  is_enabled: boolean;
  base_slug: string | null;
  tools: string[] | null;
  actions: string[] | null;
  instructions: string | null;
  archived_at: string | null;
}

interface RunTarget {
  slug: AgentSlug;
  custom?: CustomAgentRun;
}

// What a run executes as: a catalog agent, or a custom agent's base narrowed
// to its stored subset (scopedSpec in the executor/tools drops anything
// outside the base). A custom agent is off whenever its base is off.
async function runTarget(supabase: UserClient, ctx: TenantContext, def: DefinitionRow): Promise<RunTarget> {
  if (def.archived_at) throw new AppError("not_found", "Agent not found.");
  if (!def.is_enabled) throw new AppError("invalid_state", "This agent is turned off.");
  if (def.base_slug === null) return { slug: def.slug as AgentSlug };
  if (!isAgentSlug(def.base_slug)) throw new AppError("invalid_state", "This agent's base agent no longer exists.");

  const { data: base, error } = await supabase
    .from("agent_definitions")
    .select("is_enabled")
    .eq("institution_id", ctx.institution.id)
    .eq("slug", def.base_slug)
    .maybeSingle();
  if (error) throwMapped(error);
  if (!base?.is_enabled) throw new AppError("invalid_state", "The base agent of this custom agent is turned off.");
  return {
    slug: def.base_slug,
    custom: { tools: def.tools ?? [], actions: def.actions ?? [], instructions: def.instructions ?? "" },
  };
}

export interface RunAgentResult {
  runId: string;
  status: AgentRunOutcome["status"];
  summary: string;
}

// M22-T7 / M23-T19 — shared tail of agent.run (after inserting a "running"
// row) and agent.start (after claiming a "queued" row): run the executor,
// persist the outcome under the guard's finished_at rule, and hand the
// outcome back so each caller writes its own audit entry (agent.run logs
// `proposals`; agent.start never logs the task, rulings "agent.start").
async function finishRun(ctx: TenantContext, runId: string, target: RunTarget, task: string): Promise<AgentRunOutcome> {
  const { slug, custom } = target;
  // Default outcome if executeAgentRun (documented never to throw) throws
  // anyway — the `finally` below always moves the row out of "running".
  let outcome: AgentRunOutcome = {
    status: "failed",
    riskClass: "read_only",
    summary: RUN_NOT_FINISHED,
    log: [logEntry("error", "Run stopped (error)")],
    proposals: [],
  };
  try {
    outcome = await executeAgentRun(ctx, { runId, slug, task, custom });
  } catch (err) {
    console.error(`[agents] run ${runId} (${slug}) threw unexpectedly`, err);
  } finally {
    // Guard (0095): finished_at is set iff status is done|failed|rejected —
    // "awaiting_approval" must leave it null.
    const isTerminal = outcome.status === "done" || outcome.status === "failed";
    const admin = agentsAdmin();
    const { error: updateError } = await admin
      .from("agent_runs")
      .update({
        status: outcome.status,
        risk_class: outcome.riskClass,
        summary: outcome.summary,
        log: outcome.log as unknown as NonNullable<Json>,
        proposals: outcome.proposals as unknown as NonNullable<Json>,
        finished_at: isTerminal ? new Date().toISOString() : null,
      })
      .eq("id", runId);
    if (updateError) console.error(`[agents] run ${runId} failed to persist its outcome`, updateError);
  }
  return outcome;
}

export const runAgent = defineAction({
  name: "agent.run",
  module: "agents",
  schema: RunAgentSchema,
  permission: "agent.run",
  handler: async (input: RunAgentInput, ctx): Promise<RunAgentResult> => {
    // createClient() first, always (escalation.test.ts C-03: every reached
    // handler's first awaited call is the mockable user client, so the walk
    // never touches a database) — ensureAgentDefinitions's own admin write
    // comes after, order doesn't otherwise matter here.
    const supabase = await createClient();
    await ensureAgentDefinitions(ctx.institution.id);

    const { data: definition, error: definitionError } = await supabase
      .from("agent_definitions")
      .select(DEFINITION_COLUMNS)
      .eq("institution_id", ctx.institution.id)
      .eq("slug", input.slug)
      .maybeSingle();
    if (definitionError) throwMapped(definitionError);
    if (!definition) throw new AppError("not_found", "Agent not found.");
    const target = await runTarget(supabase, ctx, definition);

    const admin = agentsAdmin();
    const startedAt = new Date().toISOString();
    const { data: run, error: insertError } = await admin
      .from("agent_runs")
      .insert({
        institution_id: ctx.institution.id,
        agent_id: definition.id,
        task: input.task,
        requested_by: ctx.user.id,
        status: "running",
        catalog_version: AGENT_CATALOG_VERSION,
        started_at: startedAt,
      })
      .select("id")
      .single();
    if (insertError || !run) throwMapped(insertError);
    const runId = run.id as string;

    const outcome = await finishRun(ctx, runId, target, input.task);

    await audit(ctx, {
      action: "agent.run",
      entityType: "agent_run",
      entityId: runId,
      after: { slug: input.slug, status: outcome.status, proposals: outcome.proposals.length },
    });

    return { runId, status: outcome.status, summary: outcome.summary };
  },
});

// M23-T19 — starts a queued agent run (queued by a workflow's agent node, M23
// rulings "Agent queue") in-request as the caller, instead of waiting for a
// job. Permission `agent.run` (top-level gate); `canDecideRun` with
// `risk_class: "user_confirmed"` then narrows to the run's own requester or
// anyone holding `agent.approve` (rulings "agent.start" steps 1-5).
export const startAgentRun = defineAction({
  name: "agent.start",
  module: "agents",
  schema: DecideAgentRunSchema.pick({ runId: true }),
  permission: "agent.run",
  handler: async (input, ctx): Promise<RunAgentResult> => {
    const supabase = await createClient();

    const { data: run, error: runError } = await supabase
      .from("agent_runs")
      .select("id, status, agent_id, task, requested_by")
      .eq("institution_id", ctx.institution.id)
      .eq("id", input.runId)
      .maybeSingle();
    if (runError) throwMapped(runError);
    if (!run) throw new AppError("not_found", "Agent run not found.");
    if (run.status !== "queued") throw new AppError("invalid_state", "This run has already started.");

    const canApprove = hasPermission(ctx, "agent.approve");
    if (
      !canDecideRun(
        { userId: ctx.user.id, canApprove },
        { risk_class: "user_confirmed", requested_by: run.requested_by as string },
      )
    ) {
      throw new AppError("forbidden", "You cannot start this run.");
    }

    const { data: definition, error: definitionError } = await supabase
      .from("agent_definitions")
      .select(DEFINITION_COLUMNS)
      .eq("institution_id", ctx.institution.id)
      .eq("id", run.agent_id)
      .maybeSingle();
    if (definitionError) throwMapped(definitionError);
    if (!definition) throw new AppError("not_found", "Agent run not found.");
    const target = await runTarget(supabase, ctx, definition);

    // Claim queued -> running (lesson 2095-style conflict guard): only one
    // concurrent `agent.start` wins the row.
    const admin = agentsAdmin();
    const { data: claimed, error: claimError } = await admin
      .from("agent_runs")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (claimError) throwMapped(claimError);
    if (!claimed) throw new AppError("conflict", "This run was already started.");

    const slug = definition.slug;
    const outcome = await finishRun(ctx, run.id as string, target, (run.task as string | null) ?? "");

    await audit(ctx, {
      action: "agent.start",
      entityType: "agent_run",
      entityId: run.id as string,
      after: { slug, status: outcome.status },
    });

    return { runId: run.id as string, status: outcome.status, summary: outcome.summary };
  },
});

export interface SetAgentEnabledResult {
  slug: SetAgentEnabledInput["slug"];
  enabled: boolean;
}

export const setAgentEnabled = defineAction({
  name: "agent.definition.setEnabled",
  module: "agents",
  schema: SetAgentEnabledSchema,
  permission: "agent.approve",
  handler: async (input: SetAgentEnabledInput, ctx): Promise<SetAgentEnabledResult> => {
    const supabase = await createClient();
    await ensureAgentDefinitions(ctx.institution.id);

    const { data, error } = await supabase
      .from("agent_definitions")
      .update({ is_enabled: input.enabled })
      .eq("institution_id", ctx.institution.id)
      .eq("slug", input.slug)
      .select("id")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Agent not found.");

    await audit(ctx, {
      // record_audit_event requires a dotted-lowercase action string
      // (20261028000013): the registry/action name keeps the brief's exact
      // `agent.definition.setEnabled`, this is only the audit log string.
      action: "agent.definition.enabled_set",
      entityType: "agent_definition",
      entityId: data.id as string,
      after: { slug: input.slug, enabled: input.enabled },
    });

    return { slug: input.slug, enabled: input.enabled };
  },
});

interface DecisionRun {
  id: string;
  status: string;
  riskClass: RiskClass;
  requestedBy: string;
  definition: DefinitionRow;
  proposals: AgentProposal[];
  log: AgentLogEntry[];
}

// M22-T8 — shared read for agent.approve / agent.reject (rulings "Who
// decides"). `agent_runs.agent_id` is a composite FK, not embeddable in one
// PostgREST select, so the definition (slug, is_enabled) is a second read.
async function readDecisionRun(
  supabase: UserClient,
  ctx: TenantContext,
  runId: string,
): Promise<DecisionRun> {
  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .select("id, status, risk_class, requested_by, agent_id, proposals, log")
    .eq("institution_id", ctx.institution.id)
    .eq("id", runId)
    .maybeSingle();
  if (runError) throwMapped(runError);
  if (!run) throw new AppError("not_found", "Agent run not found.");

  const { data: definition, error: definitionError } = await supabase
    .from("agent_definitions")
    .select(DEFINITION_COLUMNS)
    .eq("institution_id", ctx.institution.id)
    .eq("id", run.agent_id)
    .maybeSingle();
  if (definitionError) throwMapped(definitionError);
  if (!definition) throw new AppError("not_found", "Agent run not found.");

  return {
    id: run.id as string,
    status: run.status as string,
    riskClass: run.risk_class as RiskClass,
    requestedBy: run.requested_by as string,
    definition,
    proposals: (run.proposals ?? []) as unknown as AgentProposal[],
    log: (run.log ?? []) as unknown as AgentLogEntry[],
  };
}

export interface DecideAgentRunResult {
  runId: string;
  status: "running" | "done" | "rejected";
  executed?: number;
  failed?: number;
}

// Shared body for agent.approve / agent.reject (rulings "Who decides", guard
// transitions). Gate permission is the common `agent.run`; the fine-grained
// decision — who may decide *this* run — is `canDecideRun` below, so an
// `agent.run`-only holder (e.g. admin) can still decide their own
// `user_confirmed` run but never a `human_approved` one.
async function decideAgentRun(
  ctx: TenantContext,
  input: DecideAgentRunInput,
  decision: "approve" | "reject",
): Promise<DecideAgentRunResult> {
  const supabase = await createClient();
  const run = await readDecisionRun(supabase, ctx, input.runId);

  if (run.status !== "awaiting_approval") {
    throw new AppError("invalid_state", "This run is not awaiting approval.");
  }
  const canApprove = hasPermission(ctx, "agent.approve");
  if (!canDecideRun({ userId: ctx.user.id, canApprove }, { risk_class: run.riskClass, requested_by: run.requestedBy })) {
    throw new AppError("forbidden", "You cannot decide this run.");
  }

  const admin = agentsAdmin();
  const decidedAt = new Date().toISOString();
  const decisionFields = { decided_by: ctx.user.id, decided_at: decidedAt, decision_note: input.note ?? null };

  if (decision === "reject") {
    const skipped = run.proposals.map((p): AgentProposal => (p.status === "proposed" ? { ...p, status: "skipped", error_code: null } : p));
    const log = [...run.log, logEntry("warn", `Rejected by ${ctx.membership.role}`), logEntry("info", "Finished: rejected")].slice(
      -MAX_LOG_ENTRIES,
    );
    const { data: claimed, error: claimError } = await admin
      .from("agent_runs")
      .update({
        ...decisionFields,
        status: "rejected",
        finished_at: decidedAt,
        proposals: skipped as unknown as NonNullable<Json>,
        log: log as unknown as NonNullable<Json>,
      })
      .eq("id", run.id)
      .eq("status", "awaiting_approval")
      .select("id")
      .maybeSingle();
    if (claimError) throwMapped(claimError);
    if (!claimed) throw new AppError("conflict", "This run was already decided.");

    await audit(ctx, { action: "agent.reject", entityType: "agent_run", entityId: run.id, after: { runId: run.id, executed: 0, failed: 0 } });
    return { runId: run.id, status: "rejected" };
  }

  // Approve re-resolves the target (enabled, base on, stored subset) before
  // claiming; reject (above) needs none of it.
  const target = await runTarget(supabase, ctx, run.definition);

  // Approve: claim the run (awaiting_approval -> running, guard-allowed),
  // then execute its proposals as the approver (rulings "AI boundary",
  // "Execution"). Mirrors runAgent's try/finally: the row always leaves
  // "running" even if executeProposals throws unexpectedly.
  const { data: claimed, error: claimError } = await admin
    .from("agent_runs")
    .update({ ...decisionFields, status: "running" })
    .eq("id", run.id)
    .eq("status", "awaiting_approval")
    .select("id")
    .maybeSingle();
  if (claimError) throwMapped(claimError);
  if (!claimed) throw new AppError("conflict", "This run was already decided.");

  let proposals = run.proposals;
  let execLog: AgentLogEntry[] = [logEntry("error", "Run stopped (error)")];
  try {
    const executed = await executeProposals(ctx, target.slug, run.proposals, target.custom);
    proposals = executed.proposals;
    execLog = executed.log;
  } catch (err) {
    console.error(`[agents] approve ${run.id} (${run.definition.slug}) threw unexpectedly`, err);
    proposals = run.proposals.map((p): AgentProposal => (p.status === "proposed" ? { ...p, status: "failed", error_code: "internal" } : p));
  } finally {
    const log = [...run.log, logEntry("info", `Approved by ${ctx.membership.role}`), ...execLog, logEntry("info", "Finished: done")].slice(
      -MAX_LOG_ENTRIES,
    );
    const { error: finishError } = await admin
      .from("agent_runs")
      .update({
        status: "done",
        proposals: proposals as unknown as NonNullable<Json>,
        log: log as unknown as NonNullable<Json>,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id);
    if (finishError) console.error(`[agents] approve ${run.id} failed to persist its outcome`, finishError);
  }

  const executed = proposals.filter((p) => p.status === "executed").length;
  const failed = proposals.filter((p) => p.status === "failed").length;
  await audit(ctx, { action: "agent.approve", entityType: "agent_run", entityId: run.id, after: { runId: run.id, executed, failed } });
  return { runId: run.id, status: "done", executed, failed };
}

export const approveAgentRun = defineAction({
  name: "agent.approve",
  module: "agents",
  schema: DecideAgentRunSchema,
  permission: "agent.run",
  handler: (input: DecideAgentRunInput, ctx) => decideAgentRun(ctx, input, "approve"),
});

export const rejectAgentRun = defineAction({
  name: "agent.reject",
  module: "agents",
  schema: DecideAgentRunSchema,
  permission: "agent.run",
  handler: (input: DecideAgentRunInput, ctx) => decideAgentRun(ctx, input, "reject"),
});

// Custom agents (0134). Writes go through the caller's own client: RLS
// (owner/principal, own institution) + the column grants + the guard
// trigger (row cap, archived rows frozen) all apply; `slug` and
// `created_by` are stamped by the DB, never by input. The Zod schema has
// already checked the tool/action subset against the base agent.
const NAME_TAKEN = "Another agent in this school already has this name.";

function throwCustomAgentError(error: unknown): never {
  if ((error as { code?: string } | null)?.code === "23505") throw new AppError("conflict", NAME_TAKEN, { name: [NAME_TAKEN] });
  throwMapped(error);
}

function customAgentRow(input: CreateCustomAgentInput | UpdateCustomAgentInput) {
  return {
    name: input.name,
    summary: input.summary,
    instructions: input.instructions,
    examples: input.examples,
    tools: [...new Set(input.tools)],
    actions: [...new Set(input.actions)],
  };
}

export interface CustomAgentResult {
  id: string;
  slug: string;
}

export const createCustomAgent = defineAction({
  name: "agent.custom.create",
  module: "agents",
  schema: CreateCustomAgentSchema,
  permission: "agent.approve",
  handler: async (input: CreateCustomAgentInput, ctx): Promise<CustomAgentResult> => {
    const supabase = await createClient();
    const row = customAgentRow(input);
    const { data, error } = await supabase
      .from("agent_definitions")
      .insert({ institution_id: ctx.institution.id, base_slug: input.baseSlug, ...row })
      .select("id, slug")
      .single();
    if (error || !data) throwCustomAgentError(error);

    await audit(ctx, {
      action: "agent.custom.create",
      entityType: "agent_definition",
      entityId: data.id,
      after: { slug: data.slug, name: row.name, baseSlug: input.baseSlug, tools: row.tools, actions: row.actions },
    });
    return { id: data.id, slug: data.slug };
  },
});

export const updateCustomAgent = defineAction({
  name: "agent.custom.update",
  module: "agents",
  schema: UpdateCustomAgentSchema,
  permission: "agent.approve",
  handler: async (input: UpdateCustomAgentInput, ctx): Promise<CustomAgentResult> => {
    const supabase = await createClient();
    const row = customAgentRow(input);
    // Matching on base_slug too: the subset was validated against this base.
    const { data, error } = await supabase
      .from("agent_definitions")
      .update(row)
      .eq("institution_id", ctx.institution.id)
      .eq("id", input.id)
      .eq("base_slug", input.baseSlug)
      .is("archived_at", null)
      .select("id, slug")
      .maybeSingle();
    if (error) throwCustomAgentError(error);
    if (!data) throw new AppError("not_found", "Custom agent not found.");

    await audit(ctx, {
      action: "agent.custom.update",
      entityType: "agent_definition",
      entityId: data.id,
      after: { slug: data.slug, name: row.name, baseSlug: input.baseSlug, tools: row.tools, actions: row.actions },
    });
    return { id: data.id, slug: data.slug };
  },
});

// "Delete" archives: past runs keep pointing at the row (agent_runs FK).
export const archiveCustomAgent = defineAction({
  name: "agent.custom.archive",
  module: "agents",
  schema: ArchiveCustomAgentSchema,
  permission: "agent.approve",
  handler: async (input, ctx): Promise<CustomAgentResult> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("agent_definitions")
      .update({ archived_at: new Date().toISOString() })
      .eq("institution_id", ctx.institution.id)
      .eq("id", input.id)
      .not("base_slug", "is", null)
      .is("archived_at", null)
      .select("id, slug")
      .maybeSingle();
    if (error) throwMapped(error);
    if (!data) throw new AppError("not_found", "Custom agent not found.");

    await audit(ctx, { action: "agent.custom.archive", entityType: "agent_definition", entityId: data.id, after: { slug: data.slug } });
    return { id: data.id, slug: data.slug };
  },
});
