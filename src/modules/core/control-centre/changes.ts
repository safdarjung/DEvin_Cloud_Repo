// A change is a list of calls to the existing core.* actions. Pure helpers here
// apply a call to the local settings (optimistic update) and compute its inverse (undo / revert).
import type { FeatureKey } from "../../../lib/auth/entitlements.ts";
import type { Role } from "../../../lib/auth/permissions.ts";
import type { ModuleKey } from "../../../lib/modules/catalog.ts";
import { mergeRoleConfig, type AiRolePatch } from "./merge.ts";
import { featureOn, moduleOn, moduleOnOrder, roleChatOn, type CcModel, type CcSettings, type Control } from "./state.ts";

export type Call =
  | { t: "module"; key: ModuleKey; enabled: boolean }
  | { t: "feature"; key: FeatureKey; enabled: boolean }
  | { t: "role"; role: Role; patch: AiRolePatch };

export function applyCall(s: CcSettings, c: Call): CcSettings {
  if (c.t === "module") return { ...s, modules: { ...s.modules, [c.key]: c.enabled } };
  if (c.t === "feature") return { ...s, features: { ...s.features, [c.key]: c.enabled } };
  return { ...s, ai_roles: { ...s.ai_roles, [c.role]: mergeRoleConfig(s.ai_roles[c.role], c.patch) } };
}

const MAPS = ["capabilities", "modes", "groups", "tasks"] as const;

/** The call that puts back what `c` changes, read from the settings before `c` is applied. */
export function inverseCall(m: CcModel, s: CcSettings, c: Call): Call {
  if (c.t === "module") return { ...c, enabled: moduleOn(s, c.key) };
  if (c.t === "feature") return { ...c, enabled: featureOn(s, c.key) };
  const before = s.ai_roles[c.role];
  const patch: AiRolePatch = {};
  if (c.patch.enabled !== undefined) patch.enabled = roleChatOn(m, s, c.role);
  for (const k of MAPS) {
    const change = c.patch[k];
    if (change) patch[k] = Object.fromEntries(Object.keys(change).map((key) => [key, (before?.[k] as Record<string, boolean> | undefined)?.[key] ?? null]));
  }
  return { t: "role", role: c.role, patch };
}

/** Calls for switching one tree control on or off. A module going off is built from its impact order by the caller. */
export function callsFor(s: CcSettings, role: Role, control: Control, next: boolean): Call[] {
  switch (control.t) {
    case "module": return next ? moduleOnOrder(s, control.key).map((key) => ({ t: "module", key, enabled: true })) : [{ t: "module", key: control.key, enabled: false }];
    case "feature": return [{ t: "feature", key: control.key, enabled: next }];
    case "mode": return [{ t: "role", role, patch: { modes: { [control.mode]: next } } }];
    case "group": return [{ t: "role", role, patch: { groups: { [control.group]: next } } }];
    case "task": return [{ t: "role", role, patch: { tasks: { [control.action]: next } } }];
    case "capability": return [{ t: "role", role, patch: { capabilities: { [control.key]: next } } }];
  }
}
