import "server-only";
// Orb task bridge — whether one task is on for a role (design §6 `taskState`,
// mirroring capabilityState). Synchronous and cheap: it reads the static catalog
// rows, the generated action facts (manifest.ts, kept equal to the registry by
// its test) and `institutions.settings.ai_roles[role].{modes,groups,tasks}` only.
// It never loads the action registry, so the tenant layout can call it on every page.
// Settings can only narrow: permission and module still gate every action in
// guardedCall; this adds the AI toggles the kernel and ai.proposal.approve enforce.
import { cache } from "react";
import { z } from "zod";
import { hasPermission, type Permission, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled, MODULES, type ModuleKey } from "@/lib/modules/catalog";
import type { OrbGroupId } from "@/modules/ai/components/orb/orb-groups";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { catalogRow, TASK_CATALOG } from "./catalog";
import { groupFor } from "./derive";
import { ACTION_FACTS } from "./manifest";
import type { ClassifiedRow, Rule6Family, TaskMode, TaskRisk } from "./types";

export type TaskLock =
  | "excluded" | "unclassified" | "permission" | "module" | "role_off" | "mode_off" | "group_off" | "task_off" | "kill_switch";

export interface TaskStateResult {
  enabled: boolean;
  lock?: TaskLock;
  reason?: string;
}

export interface EnabledTask {
  action: string;
  label: string;
  mode: TaskMode;
  groupId: OrbGroupId;
  risk: TaskRisk;
}

/** Env kill switch (design §6 "platform operator: later"): `AI_ORB_TASKS=off` turns every task off. */
export function orbTasksKilled(): boolean {
  return process.env.AI_ORB_TASKS?.trim().toLowerCase() === "off";
}

/** Design §9.4 defaults: Do, Create, Teach and Learn on; Manage off. Student/guardian Do is narrowed by their permissions. */
const defaultModeOn = (mode: TaskMode): boolean => mode !== "manage";

/** What taskState needs about one classified action: its row merged with the generated facts. */
export interface TaskSummary {
  action: string;
  label: string;
  module: ModuleKey;
  permission: Permission | null;
  mode: TaskMode;
  groupId: OrbGroupId;
  risk: TaskRisk;
  family?: Rule6Family;
  visibleWith?: Permission;
  defaultOn?: readonly Role[];
}

/** Undefined for excluded, unclassified or unregistered names. */
export function taskSummary(action: string): TaskSummary | undefined {
  const row = catalogRow(action);
  const facts = Object.hasOwn(ACTION_FACTS, action) ? ACTION_FACTS[action] : undefined;
  if (!row || row.excluded !== undefined || !facts) return undefined;
  const [permission, module, mode, risk] = facts;
  const r: ClassifiedRow = row;
  return {
    action,
    label: r.label,
    module,
    permission,
    mode: r.mode ?? mode,
    groupId: r.groupId ?? groupFor(module),
    risk: r.risk ?? risk,
    family: r.family,
    visibleWith: r.visibleWith,
    defaultOn: r.defaultOn,
  };
}

/** Default for one task: the row's `defaultOn` roles, else on unless it is a rule-6 task (design §9.4: rule-6 off). */
function defaultTaskOn(task: TaskSummary, role: Role): boolean {
  if (task.defaultOn) return task.defaultOn.includes(role);
  return task.family === undefined;
}

// Sparse per-role overrides (control centre, packet C). Parsed defensively here so a
// malformed or older settings blob never throws and never widens anything.
const Toggles = z.record(z.string().max(100), z.boolean());
const RoleTaskOverridesSchema = z.object({ modes: Toggles.optional(), groups: Toggles.optional(), tasks: Toggles.optional() });
type RoleTaskOverrides = z.infer<typeof RoleTaskOverridesSchema>;

function storedOverrides(ctx: TenantContext, role: Role): RoleTaskOverrides {
  const aiRoles = (ctx.institution.settings as Record<string, unknown> | null)?.ai_roles;
  const stored = typeof aiRoles === "object" && aiRoles !== null ? (aiRoles as Record<string, unknown>)[role] : undefined;
  const parsed = RoleTaskOverridesSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : {};
}

const aiModuleFor = (role: Role): ModuleKey => (role === "student" ? "ai_student" : "ai_teacher");

const off = (lock: TaskLock, reason: string): TaskStateResult => ({ enabled: false, lock, reason });

/**
 * Lock order (design §6): excluded > unclassified > kill switch > permission >
 * module (action's module with its `requires` chain, then the role's AI module)
 * > role's AI off > mode off > group off > task off; then the stored task
 * override, then the code default.
 */
export function taskState(ctx: TenantContext, action: string, role: Role = ctx.membership.role): TaskStateResult {
  const row = catalogRow(action);
  if (row?.excluded !== undefined) return off("excluded", `Not offered in the orb: ${row.excluded}.`);
  const task = taskSummary(action);
  if (!row || !task) return off("unclassified", "This task is not classified for the orb yet.");
  if (orbTasksKilled()) return off("kill_switch", "Orb tasks are switched off for this server.");

  const permission = task.visibleWith ?? task.permission;
  if (!permission || !hasPermission(role, permission)) return off("permission", "This role does not have permission for this task.");
  if (!isModuleEnabled(ctx, task.module)) return off("module", `The ${MODULES[task.module].label} module is off.`);
  const aiModule = aiModuleFor(role);
  if (!isModuleEnabled(ctx, aiModule)) return off("module", `The ${MODULES[aiModule].label} module is off.`);
  if (!roleAiConfig(ctx, role).enabled) return off("role_off", "AI is turned off for this role.");

  const stored = storedOverrides(ctx, role);
  if (!(stored.modes?.[task.mode] ?? defaultModeOn(task.mode))) return off("mode_off", `${task.mode} tasks are turned off for this role.`);
  if (stored.groups?.[task.groupId] === false) return off("group_off", "This group of tasks is turned off for this role.");
  if (!(stored.tasks?.[action] ?? defaultTaskOn(task, role))) return off("task_off", "This task is turned off for this role.");
  return { enabled: true };
}

/** Every classified task that is on for the caller's own role, in catalog order. Memoised per request (layout + page share it). */
export const listEnabledTasks = cache((ctx: TenantContext): readonly EnabledTask[] =>
  Object.keys(TASK_CATALOG)
    .filter((action) => taskState(ctx, action).enabled)
    .map((action) => {
      const { label, mode, groupId, risk } = taskSummary(action) as TaskSummary;
      return { action, label, mode, groupId, risk };
    }),
);
