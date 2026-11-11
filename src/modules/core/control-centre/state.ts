// Control centre — pure state: defaults, the lock chain, the trees and filters.
// No server imports: the server builds a CcModel (model.ts), the browser feeds
// it the live settings and re-renders after every optimistic change.
//
// Lock chain (same order as design §6 / A1's taskState):
//   excluded > unclassified > permission > module > role_off > mode_off > group_off > task_off
// Settings only narrow: an override can switch a thing off, never past a lock above it.
import { FEATURE_CATALOG, isFeatureEnabled, type FeatureKey } from "../../../lib/auth/entitlements.ts";
import type { Role } from "../../../lib/auth/permissions.ts";
import { MODULE_KEYS, MODULES, isModuleEnabled, type ModuleKey } from "../../../lib/modules/catalog.ts";
import type { OrbGroupId } from "../../ai/components/orb/orb-groups";
import type { OrbMode, TaskMode } from "../../ai/tasks/types";
import type { AiRoleConfig } from "../schemas.ts";
import { ORB_MODES, groupLabel, modeLabel } from "./ids.ts";

// ── inputs ────────────────────────────────────────────────────────────────
export interface CcSettings {
  modules: Record<string, boolean>;
  features: Record<string, boolean>;
  ai_roles: Partial<Record<Role, AiRoleConfig>>;
}

export type CcTask = { kind: "task"; action: string; label: string; mode: TaskMode; groupId: OrbGroupId; module?: ModuleKey; roles: readonly Role[]; defaultOn?: readonly Role[]; /** Rule-6 family: off by default. */ rule6?: boolean };
export type CcAction = CcTask | { kind: "excluded"; action: string; reason: string } | { kind: "unclassified"; action: string };

export interface CcCapability {
  key: string;
  label: string;
  description: string;
  /** chat_tool sits under Ask, task under Create. */
  kind: "chat_tool" | "task";
  groupId: OrbGroupId;
  module: ModuleKey;
  /** Roles whose ceiling and permission allow it. */
  roles: readonly Role[];
  /** Default per role when nothing is stored (legacy feature flag, else catalog defaultOn). */
  defaultOn: readonly Role[];
}

export interface CcModel {
  actions: readonly CcAction[];
  capabilities: readonly CcCapability[];
  /** AI chat switch per role when nothing is stored. */
  roleEnabledDefault: Readonly<Record<Role, boolean>>;
  /** Env kill switch: every task is off. */
  killSwitch?: boolean;
}

// ── defaults ──────────────────────────────────────────────────────────────
/** Owner default: Ask and Create on, Do/Teach/Learn on (a mode shows only for roles that have rows in it), Manage off. */
export const MODE_DEFAULT: Readonly<Record<OrbMode, boolean>> = { ask: true, do: true, create: true, teach: true, learn: true, manage: false };

const roleOf = (s: CcSettings, role: Role): AiRoleConfig => s.ai_roles[role] ?? {};
export const modeOn = (s: CcSettings, role: Role, mode: OrbMode): boolean => roleOf(s, role).modes?.[mode] ?? MODE_DEFAULT[mode];
export const groupOn = (s: CcSettings, role: Role, group: OrbGroupId): boolean => roleOf(s, role).groups?.[group] ?? true;
export const taskDefault = (a: CcTask, role: Role): boolean => a.defaultOn?.includes(role) ?? !a.rule6;
export const taskOn = (s: CcSettings, role: Role, a: CcTask): boolean => roleOf(s, role).tasks?.[a.action] ?? taskDefault(a, role);
export const capabilityOn = (s: CcSettings, role: Role, c: CcCapability): boolean => roleOf(s, role).capabilities?.[c.key] ?? c.defaultOn.includes(role);
export const roleChatOn = (m: CcModel, s: CcSettings, role: Role): boolean => roleOf(s, role).enabled ?? m.roleEnabledDefault[role];

const ctxOf = (s: CcSettings) => ({ institution: { settings: { modules: s.modules, features: s.features } } });
export const moduleOn = (s: CcSettings, key: ModuleKey): boolean => isModuleEnabled(ctxOf(s), key);
export const featureOn = (s: CcSettings, key: FeatureKey): boolean => isFeatureEnabled(ctxOf(s) as never, key);

export const roleName = (role: Role): string => role.replace(/_/g, " ");
const moduleLabel = (k: ModuleKey): string => MODULES[k].label;
const lowerFirst = (t: string): string => t.charAt(0).toLowerCase() + t.slice(1);
const requiresOf = (k: ModuleKey): readonly ModuleKey[] => ((MODULES[k] as { requires?: readonly string[] }).requires ?? []) as ModuleKey[];

// ── lock chain ────────────────────────────────────────────────────────────
export type Lock = "excluded" | "unclassified" | "permission" | "module" | "role_off" | "mode_off" | "group_off" | "task_off" | "kill_switch";
export type Fix = { kind: "module"; key: ModuleKey } | { kind: "role" } | { kind: "mode"; mode: OrbMode } | { kind: "group"; group: OrbGroupId } | { kind: "feature"; key: FeatureKey };
export interface Verdict {
  on: boolean;
  lock?: Lock;
  reason?: string;
  fix?: Fix;
}
const HARD: ReadonlySet<Lock> = new Set(["excluded", "unclassified", "permission"]);
export const isHardLock = (l: Lock | undefined): boolean => l !== undefined && HARD.has(l);

/** The module (or one it needs) that is actually switched off. */
export function offCause(s: CcSettings, key: ModuleKey): ModuleKey {
  for (const r of requiresOf(key)) if (!moduleOn(s, r)) return offCause(s, r);
  return key;
}

interface ChainInput {
  mode: OrbMode;
  group?: OrbGroupId;
  module?: ModuleKey;
  /** The role's AI chat switch applies (chat tools and tasks; not page-task capabilities). */
  chatGated: boolean;
  own: boolean;
}

function chain(m: CcModel, s: CcSettings, role: Role, i: ChainInput): Verdict {
  if (i.module && !moduleOn(s, i.module)) {
    const cause = offCause(s, i.module);
    return { on: false, lock: "module", reason: `Off because the ${moduleLabel(cause)} module is off.`, fix: { kind: "module", key: cause } };
  }
  if (m.killSwitch) return { on: false, lock: "kill_switch", reason: "Off for every school by the platform kill switch." };
  if (i.chatGated && !roleChatOn(m, s, role)) return { on: false, lock: "role_off", reason: `Off because AI is switched off for ${roleName(role)}.`, fix: { kind: "role" } };
  if (!modeOn(s, role, i.mode)) return { on: false, lock: "mode_off", reason: `Off because ${modeLabel(i.mode)} mode is off for ${roleName(role)}.`, fix: { kind: "mode", mode: i.mode } };
  if (i.group && !groupOn(s, role, i.group)) return { on: false, lock: "group_off", reason: `Off because the ${groupLabel(i.group)} group is off for ${roleName(role)}.`, fix: { kind: "group", group: i.group } };
  return i.own ? { on: true } : { on: false, lock: "task_off", reason: `Switched off for ${roleName(role)}.` };
}

export function actionVerdict(m: CcModel, s: CcSettings, role: Role, a: CcAction): Verdict {
  if (a.kind === "excluded") return { on: false, lock: "excluded", reason: `Never available to AI: ${a.reason}.` };
  if (a.kind === "unclassified") return { on: false, lock: "unclassified", reason: "Not available to AI yet." };
  if (m.killSwitch) return { on: false, lock: "kill_switch", reason: "Off for every school by the platform kill switch." };
  if (!a.roles.includes(role)) return { on: false, lock: "permission", reason: `Locked: ${roleName(role)} has no permission to ${lowerFirst(a.label)}.` };
  const aiModule: ModuleKey = role === "student" ? "ai_student" : "ai_teacher"; // same extra gate as taskState
  return chain(m, s, role, { mode: a.mode, group: a.groupId, module: a.module && moduleOn(s, a.module) ? aiModule : a.module, chatGated: true, own: taskOn(s, role, a) });
}

export function capabilityVerdict(m: CcModel, s: CcSettings, role: Role, c: CcCapability): Verdict {
  if (!c.roles.includes(role)) return { on: false, lock: "permission", reason: `Locked: ${roleName(role)} has no permission to use ${c.label}.` };
  return chain(m, s, role, { mode: c.kind === "chat_tool" ? "ask" : "create", group: c.groupId, module: c.module, chatGated: c.kind === "chat_tool", own: capabilityOn(s, role, c) });
}

/** A mode row's own verdict (role and kill switch above it). */
export const modeVerdict = (m: CcModel, s: CcSettings, role: Role, mode: OrbMode): Verdict =>
  chain(m, s, role, { mode, chatGated: true, own: modeOn(s, role, mode) });

// ── tree ──────────────────────────────────────────────────────────────────
export type Control =
  | { t: "module"; key: ModuleKey }
  | { t: "feature"; key: FeatureKey }
  | { t: "mode"; mode: OrbMode }
  | { t: "group"; group: OrbGroupId }
  | { t: "task"; action: string }
  | { t: "capability"; key: string };

export type Status = "on" | "off" | "locked";
export interface TreeNode {
  id: string;
  kind: "category" | "module" | "feature" | "mode" | "group" | "task" | "capability" | "blocked";
  label: string;
  hint?: string;
  /** Lower-case haystack for search. */
  search: string;
  status: Status;
  reason?: string;
  fix?: Fix;
  /** Absent: nothing to switch (category, always-on module, hard lock). */
  control?: Control;
  children: TreeNode[];
}

export const fixLabel = (f: Fix): string => {
  switch (f.kind) {
    case "module": return `Turn on ${moduleLabel(f.key)}`;
    case "role": return "Turn on AI for this role";
    case "mode": return `Turn on ${modeLabel(f.mode)}`;
    case "group": return `Turn on ${groupLabel(f.group)}`;
    case "feature": return `Turn on ${FEATURE_CATALOG[f.key].label}`;
  }
};

const statusOf = (v: Verdict): Status => (v.on ? "on" : isHardLock(v.lock) ? "locked" : "off");
const hay = (...parts: (string | undefined)[]): string => parts.filter(Boolean).join(" ").toLowerCase();
const byLabel = (a: { label: string }, b: { label: string }): number => a.label.localeCompare(b.label);

/** Leaf rows under a node that are not hard-locked: the "12 of 30 on" count. */
export function countOn(n: TreeNode): { on: number; total: number } {
  if (n.children.length === 0) {
    const leaf = n.kind === "task" || n.kind === "capability" || n.kind === "feature";
    return leaf && n.status !== "locked" ? { on: n.status === "on" ? 1 : 0, total: 1 } : { on: 0, total: 0 };
  }
  return n.children.reduce((a, c) => { const k = countOn(c); return { on: a.on + k.on, total: a.total + k.total }; }, { on: 0, total: 0 });
}

/** AI orb tree for one role: mode → group → capabilities and tasks, then what is not available. */
export function buildAiTree(m: CcModel, s: CcSettings, role: Role): TreeNode[] {
  type Leaf = { mode: OrbMode; group: OrbGroupId; node: TreeNode };
  const leaves: Leaf[] = [];
  const blocked: TreeNode[] = [];

  for (const a of m.actions) {
    const v = actionVerdict(m, s, role, a);
    const hard = isHardLock(v.lock);
    const node: TreeNode = {
      id: `${role}:task:${a.action}`, kind: "task", label: a.kind === "task" ? a.label : a.action, hint: a.action,
      search: hay(a.kind === "task" ? a.label : "", a.action, a.kind === "task" ? a.module : ""),
      status: statusOf(v), reason: v.reason, fix: v.fix, children: [], control: !hard && a.kind === "task" ? { t: "task", action: a.action } : undefined,
    };
    if (!hard && a.kind === "task") leaves.push({ mode: a.mode, group: a.groupId, node });
    else blocked.push(node);
  }
  for (const c of m.capabilities) {
    const v = capabilityVerdict(m, s, role, c);
    if (isHardLock(v.lock)) continue; // another role's tool: not listed here
    leaves.push({
      mode: c.kind === "chat_tool" ? "ask" : "create", group: c.groupId,
      node: { id: `${role}:cap:${c.key}`, kind: "capability", label: c.label, hint: c.description, search: hay(c.label, c.key, c.description, c.module), status: statusOf(v), reason: v.reason, fix: v.fix, children: [], control: { t: "capability", key: c.key } },
    });
  }

  const out: TreeNode[] = [];
  for (const mode of ORB_MODES) {
    const inMode = leaves.filter((l) => l.mode === mode);
    if (inMode.length === 0) continue; // a mode with nothing for this role is hidden
    const mv = modeVerdict(m, s, role, mode);
    const groups = [...new Set(inMode.map((l) => l.group))].map((group): TreeNode => {
      const gv = chain(m, s, role, { mode, group, chatGated: true, own: groupOn(s, role, group) });
      return {
        id: `${role}:group:${mode}:${group}`, kind: "group", label: groupLabel(group), search: hay(groupLabel(group), group),
        status: statusOf(gv), reason: gv.reason, fix: gv.fix, control: { t: "group", group },
        children: inMode.filter((l) => l.group === group).map((l) => l.node).sort(byLabel),
      };
    }).sort(byLabel);
    out.push({ id: `${role}:mode:${mode}`, kind: "mode", label: modeLabel(mode), search: hay(modeLabel(mode)), status: statusOf(mv), reason: mv.reason, fix: mv.fix, control: { t: "mode", mode }, children: groups });
  }
  if (blocked.length > 0) {
    out.push({ id: `${role}:blocked`, kind: "blocked", label: "Not available to this role or to AI", hint: "Locked by permissions, or kept out of the orb.", search: "", status: "locked", children: blocked.sort(byLabel) });
  }
  return out;
}

/** System tree: category → module → features (a feature with a parent nests under it). */
export function buildSystemTree(s: CcSettings): TreeNode[] {
  const categories = [...new Set(MODULE_KEYS.map((k) => MODULES[k].category))];
  return categories.map((category): TreeNode => ({
    id: `cat:${category}`, kind: "category", label: category, search: hay(category), status: "on",
    children: MODULE_KEYS.filter((k) => MODULES[k].category === category).map((key): TreeNode => {
      const entry = MODULES[key] as { label: string; description: string; core?: true };
      const on = moduleOn(s, key);
      const cause = on ? key : offCause(s, key);
      const needs = !on && cause !== key;
      const features = (Object.keys(FEATURE_CATALOG) as FeatureKey[]).filter((f) => FEATURE_CATALOG[f].module === key);
      const featureNode = (f: FeatureKey): TreeNode => {
        const e = FEATURE_CATALOG[f];
        const fo = featureOn(s, f);
        const parentOff = e.parent !== undefined && !featureOn(s, e.parent);
        const reason = fo ? undefined : !on ? `Off because the ${moduleLabel(cause)} module is off.` : parentOff ? `Off because ${FEATURE_CATALOG[e.parent!].label} is off.` : "Switched off for this school.";
        const fix: Fix | undefined = fo ? undefined : !on ? { kind: "module", key: cause } : parentOff ? { kind: "feature", key: e.parent! } : undefined;
        return {
          id: `feature:${f}`, kind: "feature", label: e.label, hint: f, search: hay(e.label, f, entry.label), status: fo ? "on" : "off", reason, fix,
          control: { t: "feature", key: f }, children: features.filter((c) => FEATURE_CATALOG[c].parent === f).map(featureNode).sort(byLabel),
        };
      };
      return {
        id: `module:${key}`, kind: "module", label: entry.label, hint: entry.description, search: hay(entry.label, key, entry.description, category),
        status: on ? "on" : "off",
        reason: on ? undefined : needs ? `Off because it needs the ${moduleLabel(cause)} module.` : "Switched off for this school.",
        fix: needs ? { kind: "module", key: cause } : undefined,
        control: entry.core === true ? undefined : { t: "module", key },
        children: features.filter((f) => !FEATURE_CATALOG[f].parent).map(featureNode).sort(byLabel),
      };
    }),
  }));
}

// ── search and filter ─────────────────────────────────────────────────────
export type StatusFilter = "all" | Status;

/** Keep a leaf when it (or a branch above it) matches every search word and the status filter; keep branches that still have leaves. */
export function filterTree(nodes: readonly TreeNode[], query: string, status: StatusFilter): TreeNode[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const walk = (list: readonly TreeNode[], above: boolean): TreeNode[] =>
    list.flatMap((n) => {
      const self = above || words.every((w) => n.search.includes(w));
      if (n.children.length === 0) return (words.length === 0 || self) && (status === "all" || n.status === status) ? [n] : [];
      const kids = walk(n.children, words.length > 0 && self);
      return kids.length > 0 ? [{ ...n, children: kids }] : [];
    });
  return walk(nodes, false);
}

// ── module off: what else goes off ────────────────────────────────────────
export interface ModuleImpact {
  /** Enabled modules that need this one, transitively. */
  dependents: ModuleKey[];
  /** Order to switch off: dependents first, the module last (core.module.set refuses otherwise). */
  order: ModuleKey[];
  features: string[];
  capabilities: string[];
  /** Orb tasks that are on for at least one role today. */
  tasks: string[];
}

export function moduleOffImpact(m: CcModel, s: CcSettings, key: ModuleKey, roles: readonly Role[]): ModuleImpact {
  const order: ModuleKey[] = [];
  const visit = (k: ModuleKey) => {
    for (const d of MODULE_KEYS) if (requiresOf(d).includes(k) && moduleOn(s, d) && !order.includes(d)) visit(d);
    if (!order.includes(k)) order.push(k);
  };
  visit(key);
  const affected = new Set(order);
  const tasks = m.actions.filter((a): a is CcTask => a.kind === "task" && a.module !== undefined && affected.has(a.module) && roles.some((r) => actionVerdict(m, s, r, a).on));
  return {
    dependents: order.filter((k) => k !== key),
    order,
    features: (Object.keys(FEATURE_CATALOG) as FeatureKey[]).filter((f) => affected.has(FEATURE_CATALOG[f].module) && featureOn(s, f)).map((f) => FEATURE_CATALOG[f].label),
    capabilities: m.capabilities.filter((c) => affected.has(c.module) && roles.some((r) => capabilityVerdict(m, s, r, c).on)).map((c) => c.label),
    tasks: tasks.map((a) => a.label),
  };
}

/** Modules to switch on, requirements first. */
export function moduleOnOrder(s: CcSettings, key: ModuleKey): ModuleKey[] {
  const order: ModuleKey[] = [];
  const visit = (k: ModuleKey) => {
    for (const r of requiresOf(k)) if (!moduleOn(s, r)) visit(r);
    if (!order.includes(k)) order.push(k);
  };
  visit(key);
  return order;
}
