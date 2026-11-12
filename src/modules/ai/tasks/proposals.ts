import "server-only";
// Orb task bridge — proposal lifecycle (design §3, §4 "Server enforcement", §7).
// create: the task must be on for the caller; human-only, generated and
// context keys are stripped so the stored row never holds a value the AI may
// not supply; every entity is resolved under the caller's RLS; one
// ai_proposals row per card. approve: re-checks taskState, claims the row
// once (pending → approving), and calls the TARGET registered action through
// the registry exactly as agents/executor.ts does, so its own Zod, permission,
// module and RLS gates run. Nothing executes without the approve click.
import type { z } from "zod";
import { AppError, type ActionResult, type ErrorCode } from "@/lib/actions/result";
import { getRegisteredActions } from "@/lib/actions/registry";
import type { TenantContext } from "@/lib/auth/types";
import { audit } from "@/lib/audit";
import type { Json } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { NAV_ITEMS } from "@/lib/nav";
import { hasPermission } from "@/lib/auth/require";
import { listMyChildren } from "@/modules/people/queries";
import { choicePatches } from "./choices";
import { actionJsonSchema, deriveFieldKind, schemaFields, type JsonSchemaNode, type SchemaField } from "./derive";
import { findEntity, searchEntities, SEARCHABLE_ENTITIES } from "./entities";
import { EXPANDERS, relativeDate } from "./expanders";
import { getAt, resolveEntities, withoutPaths, type Values } from "./resolve-refs";
import { classifiedTask, taskActionMeta } from "./classified";
import { orbTasksAdmin } from "./service-role";
import { taskState } from "./state";
import type { ClassifiedTask, EntityOption, TaskFieldView, TaskProposalOutput, TaskView } from "./types";

/** Cards per chat turn (design §7 rate limits). */
export const MAX_PROPOSALS = 5;
export const PROPOSAL_TTL_MS = 30 * 60_000;
export const APPROVALS_PER_MINUTE = 20;
/** New cards per user per minute (chat tool and ai.proposal.start together); far above normal use. */
export const PROPOSALS_PER_MINUTE = 30;
/** Matches the ai_proposals.proposed size check (migration 0143). */
const MAX_PROPOSED_BYTES = 8_192;

const PROVENANCE_SOURCES: readonly (readonly [RegExp, string])[] = [
  [/^helpdesk\./, "helpdesk tickets"],
  [/^admissions\./, "admission enquiries"],
  [/^messaging\./, "messages"],
  [/^forms?\./, "form responses"],
];

/** "Suggested after reading <source>" when this turn read free-text records (design §3 containment). */
export function provenanceFor(queries: readonly string[]): string | undefined {
  const hit = PROVENANCE_SOURCES.find(([re]) => queries.some((q) => re.test(q)));
  return hit ? `Suggested after reading ${hit[1]}` : undefined;
}

// ── field views ───────────────────────────────────────────────────────────

// Field names that read badly once humanised ("staffId" → "Staff").
const LABEL_OVERRIDES: Readonly<Record<string, string>> = { staffId: "Staff member", hostStaffId: "Host staff member" };
const labelFor = (name: string): string => {
  if (LABEL_OVERRIDES[name]) return LABEL_OVERRIDES[name];
  const words = name.replace(/Ids?$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

function isChild(parent: string, path: string): boolean {
  if (!path.startsWith(`${parent}/`)) return false;
  const rest = path.slice(parent.length + 1).replace(/^\*\//, "");
  return !rest.includes("/") && rest !== "*";
}

function fieldView(task: ClassifiedTask, all: readonly SchemaField[], f: SchemaField): TaskFieldView {
  const derived = deriveFieldKind(task.module, f);
  const entity = task.entities[f.path];
  const kind = task.generated.includes(f.path) ? "generated" : entity === "context" ? "context" : derived;
  const items = f.node.items;
  const children = kind === "array" || kind === "object" ? all.filter((c) => isChild(f.path, c.path)).map((c) => fieldView(task, all, c)) : [];
  const view: TaskFieldView = {
    path: f.path,
    label: labelFor(f.name),
    kind,
    required: f.required,
    ...(kind === "entity" && entity && entity !== "context" ? { entity } : {}),
    ...(f.node.type === "array" && items && items.type !== "object" ? { multiple: true } : {}),
    ...(f.node.enum ?? items?.enum ? { options: (f.node.enum ?? items?.enum ?? []).map(String) } : {}),
    ...(f.node.maxLength !== undefined ? { maxLength: f.node.maxLength } : {}),
    ...(f.node.minimum !== undefined ? { min: f.node.minimum } : {}),
    ...(f.node.maximum !== undefined ? { max: f.node.maximum } : {}),
    ...(f.node.maxItems !== undefined ? { maxItems: f.node.maxItems } : {}),
    ...(task.humanOnly.includes(f.path) ? { humanOnly: true } : {}),
    ...(children.length ? { fields: children } : {}),
  };
  return view;
}

export function buildFields(task: ClassifiedTask, schema: JsonSchemaNode): TaskFieldView[] {
  const all = schemaFields(schema);
  return all.filter((f) => f.path.lastIndexOf("/") === 0).map((f) => fieldView(task, all, f));
}

/** Title from the label and resolved top-level names only, never model text. */
function titleFor(task: ClassifiedTask, resolved: Readonly<Record<string, EntityOption>>): string {
  const names = Object.entries(resolved)
    .filter(([path]) => path.lastIndexOf("/") === 0)
    .map(([, o]) => o.label);
  return names.length ? `${task.label}: ${names.slice(0, 3).join(", ")}` : task.label;
}

// ── sanitising ────────────────────────────────────────────────────────────

const contextPaths = (task: ClassifiedTask): string[] => Object.keys(task.entities).filter((p) => task.entities[p] === "context");

/** Human-only, generated and context values never come from the model (design C6); unknown top-level keys are dropped too. */
export function sanitizeValues(task: ClassifiedTask, schema: JsonSchemaNode, values: Values): Values {
  const stripped = withoutPaths(values, [...task.humanOnly, ...task.generated, ...contextPaths(task)]);
  const known = new Set(Object.keys(schema.properties ?? {}));
  return Object.fromEntries(Object.entries(stripped).filter(([k, v]) => known.has(k) && v !== undefined && v !== null && v !== ""));
}

/** Top-level date fields given as today/tomorrow/yesterday become YYYY-MM-DD in the school's timezone. */
function withRelativeDates(ctx: TenantContext, task: ClassifiedTask, schema: JsonSchemaNode, values: Values): Values {
  const dates = schemaFields(schema).filter((f) => f.path.lastIndexOf("/") === 0 && deriveFieldKind(task.module, f) === "date");
  return { ...values, ...Object.fromEntries(dates.filter((f) => values[f.name] !== undefined).map((f) => [f.name, relativeDate(ctx, values[f.name])])) };
}

/** Guardian: studentId pinned to a verified child; student: to their own record (design §7). */
export async function pinStudent(ctx: TenantContext, schema: JsonSchemaNode, values: Values, childId?: string): Promise<Values> {
  if (!schema.properties?.studentId) return values;
  const role = ctx.membership.role;
  if (role === "student") return ctx.membership.studentId ? { ...values, studentId: ctx.membership.studentId } : values;
  if (role !== "guardian") return values;
  if (childId) return { ...values, studentId: childId };
  const children = await listMyChildren(ctx);
  const asked = values.studentId;
  const match = children.find((c) => c.id === asked) ?? (children.length === 1 ? children[0] : undefined);
  const rest = withoutPaths(values, ["/studentId"]);
  return match ? { ...rest, studentId: match.id } : rest;
}

/** A required top-level picker with exactly one option the caller can see (one academic year, one campus) is prefilled: there is nothing to choose. */
async function withOnlyChoice(ctx: TenantContext, task: ClassifiedTask, schema: JsonSchemaNode, values: Values): Promise<Values> {
  const out = { ...values };
  for (const [pattern, entity] of Object.entries(task.entities)) {
    const key = pattern.slice(1);
    if (entity === "context" || pattern.lastIndexOf("/") !== 0 || out[key] !== undefined) continue;
    if (!schema.required?.includes(key) || !SEARCHABLE_ENTITIES.includes(entity)) continue;
    const options = await searchEntities(ctx, entity);
    if (options.length === 1) out[key] = options[0]!.id;
  }
  return out;
}

/** Ids for entity types with no picker source cannot be checked here; a person may still pass one (the target action's RLS decides). */
function keepUnverifiable(task: ClassifiedTask, raw: Values, resolvedValues: Values): Values {
  const out = structuredClone(resolvedValues);
  for (const [pattern, entity] of Object.entries(task.entities)) {
    if (entity === "context" || SEARCHABLE_ENTITIES.includes(entity) || pattern.includes("*")) continue;
    const key = pattern.slice(1);
    if (pattern.lastIndexOf("/") === 0 && out[key] === undefined && typeof raw[key] === "string") out[key] = raw[key];
  }
  return out;
}

// ── create ────────────────────────────────────────────────────────────────

export interface CreateProposalInput {
  action: string;
  values?: Values;
  /** An earlier proposal of the same turn this card waits for. */
  dependsOn?: string;
  /** Guardian chat: the verified child every studentId is pinned to. */
  childId?: string;
  provenance?: string;
  /** "person": values typed or clicked by the signed-in person (ai.proposal.start); "model": the chat tool. */
  source: "model" | "person";
  /** A pending card of the same task this one replaces (a section picked on an empty register): closed before the new one is saved. */
  replaces?: string;
}

/** Field view overrides by pattern path, applied at every depth. */
function patchFields(fields: readonly TaskFieldView[], patches: Readonly<Record<string, Partial<TaskFieldView>>>): TaskFieldView[] {
  return fields.map((f) => ({ ...f, ...patches[f.path], ...(f.fields ? { fields: patchFields(f.fields, patches) } : {}) }));
}

function unavailable(reason?: string): AppError {
  return new AppError("forbidden", reason ? `This task is not available: ${reason}` : "This task is not available.");
}

async function enforceProposalRate(ctx: TenantContext): Promise<void> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ai_proposals")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institution.id)
    .eq("created_by", ctx.user.id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if (error) throw new AppError("internal", "Could not check the card rate.");
  if ((count ?? 0) >= PROPOSALS_PER_MINUTE) throw new AppError("rate_limited", "Too many cards in a minute. Wait a moment and try again.");
}

export async function createProposal(ctx: TenantContext, input: CreateProposalInput): Promise<TaskProposalOutput> {
  const state = taskState(ctx, input.action);
  const task = classifiedTask(input.action);
  const meta = taskActionMeta(input.action);
  if (!state.enabled || !task || !meta) throw unavailable(state.reason);
  await enforceProposalRate(ctx);
  const schema = actionJsonSchema(meta);

  let values = await pinStudent(ctx, schema, withRelativeDates(ctx, task, schema, sanitizeValues(task, schema, input.values ?? {})), input.childId);
  let known: Record<string, EntityOption> = {};
  const expander = EXPANDERS[input.action];
  if (expander) {
    const intent = withoutPaths(input.values ?? {}, [...task.humanOnly, ...task.generated, ...contextPaths(task)]);
    ({ values, known } = await expander.expand(ctx, { ...intent, ...values }));
    values = sanitizeValues(task, schema, values);
  }
  values = await withOnlyChoice(ctx, task, schema, values);
  const resolution = await resolveEntities(ctx, task, values, known);
  const finalValues = input.source === "person" ? keepUnverifiable(task, values, resolution.values) : resolution.values;

  const proposed = JSON.stringify(finalValues);
  if (new TextEncoder().encode(proposed).length > MAX_PROPOSED_BYTES) {
    throw new AppError("validation_failed", "This card is too large. Split the request into smaller ones.");
  }

  // Close the replaced card first (conditional pending → discarded), so it can never be approved once replaced.
  if (input.replaces) {
    const old = await loadOwn(ctx, input.replaces);
    if (old.action !== input.action) throw new AppError("validation_failed", "A card can only be replaced by a card for the same task.");
    await requirePending(ctx, old);
    if (!(await setStatus(ctx, old.id, "pending", { status: "discarded" }))) throw new AppError("conflict", CLOSED_MESSAGE.approving!);
    await audit(ctx, { action: "ai.proposal.discarded", entityType: "ai_proposal", entityId: old.id, after: { proposalId: old.id, action: old.action } });
  }

  const supabase = await createClient();
  if (input.dependsOn) {
    const { data: parent, error } = await supabase
      .from("ai_proposals")
      .select("id")
      .eq("id", input.dependsOn)
      .eq("institution_id", ctx.institution.id)
      .eq("created_by", ctx.user.id)
      .maybeSingle();
    if (error) throw new AppError("internal", "Could not read the earlier card.");
    if (!parent) throw new AppError("not_found", "The earlier card was not found.");
  }

  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS).toISOString();
  const { error } = await supabase.from("ai_proposals").insert({
    id,
    institution_id: ctx.institution.id,
    created_by: ctx.user.id,
    action: input.action,
    proposed: finalValues as NonNullable<Json>,
    depends_on: input.dependsOn ?? null,
    expires_at: expiresAt,
  });
  if (error) throw new AppError("internal", "Could not save the card.");
  await audit(ctx, { action: "ai.proposal.created", entityType: "ai_proposal", entityId: id, after: { proposalId: id, action: input.action } });

  const view: TaskView = {
    action: input.action,
    label: task.label,
    title: titleFor(task, resolution.resolved),
    mode: task.mode,
    groupId: task.groupId,
    risk: task.risk,
    ...(task.family ? { family: task.family } : {}),
    ...(task.renderer ? { renderer: task.renderer } : {}),
    // An upsert's optional "/id" is only for editing an existing record; on a new one it is noise.
    fields: patchFields(patchFields(buildFields(task, schema), expander?.fields?.(ctx) ?? {}), choicePatches(ctx, input.action)).filter((f) => f.path !== "/id" || f.required || finalValues.id !== undefined),
    ...(task.requireOneOf ? { requireOneOf: task.requireOneOf } : {}),
    values: finalValues,
    resolved: resolution.resolved,
    candidates: resolution.candidates,
    ...(input.dependsOn ? { dependsOn: input.dependsOn } : {}),
    ...(input.provenance ? { provenance: input.provenance } : {}),
    ...(task.undo ? { undo: task.undo } : {}),
    expiresAt,
  };
  return { kind: "task_proposal", proposalId: id, view };
}

// ── approve / discard / opened ────────────────────────────────────────────

interface ProposalRow {
  id: string;
  action: string;
  status: string;
  depends_on: string | null;
  expires_at: string;
}

async function loadOwn(ctx: TenantContext, proposalId: string): Promise<ProposalRow> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_proposals")
    .select("id, action, status, depends_on, expires_at")
    .eq("id", proposalId)
    .eq("institution_id", ctx.institution.id)
    .eq("created_by", ctx.user.id)
    .maybeSingle();
  if (error) throw new AppError("internal", "Could not read the card.");
  if (!data) throw new AppError("not_found", "Card not found.");
  return data;
}

const CLOSED_MESSAGE: Readonly<Record<string, string>> = {
  approving: "This card is already being approved.",
  approved: "This card was already approved.",
  discarded: "This card was discarded.",
  expired: "This proposal expired. Ask again.",
  failed: "This card failed earlier. Ask again.",
};

/** Conditional status change (from → patch.status) through the service role: authenticated has no UPDATE on ai_proposals (0143). Callers read the row under RLS first (loadOwn). */
async function setStatus(ctx: TenantContext, id: string, from: string, patch: { status: string; error_code?: string | null; result_ref?: Json; changed_keys?: string[] }) {
  const { data, error } = await orbTasksAdmin()
    .from("ai_proposals")
    .update(patch)
    .eq("id", id)
    .eq("institution_id", ctx.institution.id)
    .eq("created_by", ctx.user.id)
    .eq("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new AppError("internal", "Could not update the card.");
  return data !== null;
}

/** Pending and not expired, else a closed-card error (expired cards are marked so on the way). */
async function requirePending(ctx: TenantContext, row: ProposalRow): Promise<void> {
  if (row.status === "pending" && Date.parse(row.expires_at) <= Date.now()) {
    await setStatus(ctx, row.id, "pending", { status: "expired" });
    throw new AppError("invalid_state", CLOSED_MESSAGE.expired!);
  }
  if (row.status !== "pending") throw new AppError(row.status === "approving" ? "conflict" : "invalid_state", CLOSED_MESSAGE[row.status] ?? "This card is closed.");
}

async function enforceApprovalRate(ctx: TenantContext): Promise<void> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("ai_proposals")
    .select("id", { count: "exact", head: true })
    .eq("institution_id", ctx.institution.id)
    .eq("created_by", ctx.user.id)
    .in("status", ["approving", "approved", "failed"])
    .gte("updated_at", new Date(Date.now() - 60_000).toISOString());
  if (error) throw new AppError("internal", "Could not check the approval rate.");
  if ((count ?? 0) >= APPROVALS_PER_MINUTE) throw new AppError("rate_limited", "Too many approvals in a minute. Wait a moment and try again.");
}

/** Zod issues → concrete JSON pointers, so nested rows and .refine rules reach the card (design C4). */
export function pointerErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const pointer = issue.path.length ? `/${issue.path.map(String).join("/")}` : "/";
    (out[pointer] ??= []).push(issue.message);
  }
  return out;
}

const asPointerKeys = (fieldErrors: Record<string, string[]> | undefined) =>
  fieldErrors ? Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k.startsWith("/") ? k : `/${k}`, v])) : undefined;

/** Ids and short scalars of the target's result: what a dependent card or an undo needs, nothing more. */
function resultRef(data: unknown): Record<string, string | number | boolean> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(data)) {
    if (Object.keys(out).length >= 10) break;
    if ((typeof v === "string" && v.length <= 100) || typeof v === "number" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

export interface UndoOffer {
  action: string;
  label: string;
  /** Pass back as `values` to ai.proposal.start to open the undo card prefilled. */
  values?: Values;
}

export interface ApproveResult {
  status: "approved";
  resultHref?: string;
  resultLabel?: string;
  undo?: UndoOffer;
}

/** Undo values: each top-level field of the undo action from the approved input or the result (the new record's `id`). */
function undoOffer(ctx: TenantContext, task: ClassifiedTask, input: Values, ref: Values): UndoOffer | undefined {
  const undo = task.undo ? classifiedTask(task.undo) : undefined;
  const meta = task.undo ? taskActionMeta(task.undo) : undefined;
  if (!undo || !meta || !taskState(ctx, undo.action).enabled) return undefined;
  const fields = Object.keys(actionJsonSchema(meta).properties ?? {});
  const idFields = fields.filter((f) => /Id$/.test(f) && input[f] === undefined && ref[f] === undefined);
  const values = Object.fromEntries(
    fields.flatMap((f) => {
      const v = input[f] ?? ref[f] ?? (idFields.length === 1 && f === idFields[0] ? ref.id : undefined);
      return v === undefined ? [] : [[f, v]];
    }),
  );
  return { action: undo.action, label: undo.label, ...(Object.keys(values).length ? { values } : {}) };
}

export async function approveProposal(ctx: TenantContext, proposalId: string, cardValues: Values): Promise<ApproveResult> {
  const row = await loadOwn(ctx, proposalId);
  await requirePending(ctx, row);
  await enforceApprovalRate(ctx);
  const state = taskState(ctx, row.action);
  const task = classifiedTask(row.action);
  const meta = taskActionMeta(row.action);
  const action = getRegisteredActions().get(row.action);
  if (!state.enabled || !task || !meta || !action) throw unavailable(state.reason);
  const schema = actionJsonSchema(meta);

  // The person's values, minus anything only the server fills.
  let input: Values = withoutPaths(cardValues, [...task.generated.filter((p) => p !== "/idempotencyKey"), ...contextPaths(task)]);
  input = withoutPaths(input, ["/idempotencyKey"]);
  if (schema.properties?.idempotencyKey) input.idempotencyKey = row.id; // one key per card, reused on retry
  if (row.depends_on) {
    const parent = await loadOwnParent(ctx, row.depends_on);
    for (const pattern of contextPaths(task)) {
      const key = pattern.slice(1);
      if (pattern.lastIndexOf("/") === 0 && parent[key] !== undefined) input[key] = parent[key];
    }
  }
  if (schema.properties?.studentId && (ctx.membership.role === "guardian" || ctx.membership.role === "student")) {
    const pinned = await pinStudent(ctx, schema, input);
    if (pinned.studentId !== input.studentId) throw new AppError("forbidden", "That student is not yours to act for.");
  }

  const missing = missingOneOf(task, input);
  if (missing) throw new AppError("validation_failed", "Fill one of the highlighted fields.", missing);
  const parsed = meta.schema.safeParse(input);
  if (!parsed.success) throw new AppError("validation_failed", "Check the highlighted fields.", spreadOverGroups(task, pointerErrors(parsed.error)));

  if (!(await setStatus(ctx, row.id, "pending", { status: "approving", error_code: null }))) {
    throw new AppError("conflict", CLOSED_MESSAGE.approving!);
  }
  let result: ActionResult<unknown>;
  try {
    result = (await action(ctx.institution.slug, input)) as ActionResult<unknown>;
  } catch (err) {
    console.error(`[orb-bridge] ${row.action} threw`, err);
    await setStatus(ctx, row.id, "approving", { status: "failed", error_code: "internal" });
    throw new AppError("internal", "Something went wrong while approving this card.");
  }
  if (!result.ok) {
    // Refused by the target's own gates: the card stays open for a corrected retry (same idempotency key).
    await setStatus(ctx, row.id, "approving", { status: "pending", error_code: result.error.code });
    throw new AppError(result.error.code as ErrorCode, result.error.message, asPointerKeys(result.error.fieldErrors));
  }
  const ref = resultRef(result.data);
  const changedKeys = Object.keys(input).filter((k) => k !== "idempotencyKey");
  await setStatus(ctx, row.id, "approving", { status: "approved", result_ref: ref, changed_keys: changedKeys });
  await audit(ctx, { action: "ai.proposal.approved", entityType: "ai_proposal", entityId: row.id, after: { proposalId: row.id, action: row.action, changedKeys } });
  const undo = undoOffer(ctx, task, input, ref);
  return { status: "approved", resultHref: resultHref(ctx, task), resultLabel: await resultLabel(ctx, task, input, ref), ...(undo ? { undo } : {}) };
}

// ── one-of rules, result line and link ───────────────────────────────────

const hasValue = (v: unknown): boolean => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);

/** A requireOneOf group with no value at all → an error on every path of the group. */
export function missingOneOf(task: Pick<ClassifiedTask, "requireOneOf" | "label">, input: Values): Record<string, string[]> | null {
  const out: Record<string, string[]> = {};
  for (const group of task.requireOneOf ?? []) {
    if (group.some((p) => hasValue(getAt(input, p)))) continue;
    const names = group.map((p) => labelFor(p.slice(p.lastIndexOf("/") + 1)).toLowerCase()).join(" or ");
    for (const p of group) out[p] = [`Fill in the ${names}.`];
  }
  return Object.keys(out).length ? out : null;
}

/** The target's own one-of refine reports on one path; show it on every path of the group. */
function spreadOverGroups(task: ClassifiedTask, errors: Record<string, string[]>): Record<string, string[]> {
  const out = { ...errors };
  for (const group of task.requireOneOf ?? []) {
    const hit = group.find((p) => out[p]);
    if (hit) for (const p of group) out[p] ??= out[hit]!;
  }
  return out;
}

const PAST: Readonly<Record<string, string>> = {
  add: "Added", approve: "Approved", assign: "Assigned", book: "Booked", cancel: "Cancelled", check: "Checked", create: "Created",
  delete: "Deleted", dismiss: "Dismissed", draft: "Drafted", edit: "Edited", issue: "Issued", join: "Joined", leave: "Left", mark: "Marked",
  message: "Messaged", move: "Moved", post: "Posted", publish: "Published", raise: "Raised", record: "Recorded", reject: "Rejected",
  renew: "Renewed", reply: "Replied", request: "Requested", resolve: "Resolved", save: "Saved", send: "Sent", submit: "Submitted",
  update: "Updated", write: "Wrote",
};

const shortDate = (iso: string): string =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/** "Issued LIB-0239 to Aditya Patel, due 25 Nov": the row's `done` template, else the label in the past tense plus the names. */
async function resultLabel(ctx: TenantContext, task: ClassifiedTask, input: Values, ref: Values): Promise<string> {
  const names: Record<string, string> = {};
  for (const [pattern, entity] of Object.entries(task.entities)) {
    const key = pattern.slice(1);
    if (entity === "context" || pattern.lastIndexOf("/") !== 0 || typeof input[key] !== "string") continue;
    const option = await findEntity(ctx, entity, input[key] as string, {}).catch(() => null);
    if (option) names[key] = option.label;
  }
  const text = (key: string): string => {
    const v = names[key] ?? ref[key] ?? input[key];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return shortDate(v);
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  };
  if (task.done) return task.done.replace(/\{(\w+)\}/g, (_m, key: string) => text(key)).replace(/\s+,/g, ",").trim();
  const [verb, ...rest] = task.label.split(" ");
  const past = PAST[verb!.toLowerCase()];
  const head = past ? `${past} ${rest.join(" ")}` : task.label;
  const shown = Object.values(names).slice(0, 3);
  return shown.length ? `${head}: ${shown.join(", ")}` : head;
}

/** The page where the record lives: the row's `href`, else the module's nav page the person can open; portal roles stay in /portal. */
export function resultHref(ctx: TenantContext, task: Pick<ClassifiedTask, "href" | "module">): string {
  const portal = ctx.membership.role === "guardian" || ctx.membership.role === "student";
  const own = task.href;
  const nav = NAV_ITEMS.find((i) => i.module === task.module && !i.demoOnly && hasPermission(ctx, i.permission))?.href;
  const path = portal ? (own?.startsWith("/portal") ? own : "/portal") : own && !own.startsWith("/portal") ? own : (nav ?? "/orb");
  return `/${ctx.institution.slug}${path}`;
}

/** The earlier card's result, only once it is approved (design §3 multi-step). */
async function loadOwnParent(ctx: TenantContext, parentId: string): Promise<Values> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_proposals")
    .select("status, result_ref")
    .eq("id", parentId)
    .eq("institution_id", ctx.institution.id)
    .eq("created_by", ctx.user.id)
    .maybeSingle();
  if (error) throw new AppError("internal", "Could not read the earlier card.");
  if (!data || data.status !== "approved") throw new AppError("invalid_state", "Approve the earlier card first.");
  return (data.result_ref ?? {}) as Values;
}

export async function discardProposal(ctx: TenantContext, proposalId: string): Promise<{ status: "discarded" }> {
  const row = await loadOwn(ctx, proposalId);
  await requirePending(ctx, row);
  if (!(await setStatus(ctx, row.id, "pending", { status: "discarded" }))) throw new AppError("conflict", CLOSED_MESSAGE.approving!);
  await audit(ctx, { action: "ai.proposal.discarded", entityType: "ai_proposal", entityId: row.id, after: { proposalId: row.id, action: row.action } });
  return { status: "discarded" };
}

/** A renderer-hosted card (rule 6) was opened: the hosted form calls its own action; the bridge only records this. */
export async function openedProposal(ctx: TenantContext, proposalId: string): Promise<{ status: "opened" }> {
  const row = await loadOwn(ctx, proposalId);
  await audit(ctx, { action: "ai.proposal.opened", entityType: "ai_proposal", entityId: row.id, after: { proposalId: row.id, action: row.action } });
  return { status: "opened" };
}
