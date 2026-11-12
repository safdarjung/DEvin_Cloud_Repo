import "server-only";
// Builds the serialisable CcModel the control centre runs on: every registered
// action classified (or excluded / unclassified), the AI capabilities, and the
// per-role chat default. Read-only; all writes go through core.* actions.
import "@/app/api/v1/actions/all-actions";
import { getActionMeta } from "@/lib/actions/registry";
import { hasPermission, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { CAPABILITIES, CAPABILITY_KEYS } from "@/modules/ai/capabilities/catalog";
import { roleAiConfig } from "@/modules/ai/capabilities/resolve";
import { groupIdFor } from "@/modules/ai/components/orb/orb-groups";
import { UNCLASSIFIED, catalogRow } from "@/modules/ai/tasks/catalog";
import { classify } from "@/modules/ai/tasks/derive";
import { orbTasksKilled } from "@/modules/ai/tasks/state";
import { AI_ROLES } from "@/modules/core/schemas";
import type { CcAction, CcCapability, CcModel, CcSettings } from "./state";

const ROLES: readonly Role[] = AI_ROLES;

export function buildCcModel(ctx: TenantContext): CcModel {
  const actions: CcAction[] = [];
  for (const [name, meta] of getActionMeta()) {
    const row = catalogRow(name);
    if (!row) {
      if (UNCLASSIFIED.includes(name)) actions.push({ kind: "unclassified", action: name });
      continue;
    }
    if (row.excluded !== undefined) {
      actions.push({ kind: "excluded", action: name, reason: row.excluded });
      continue;
    }
    const t = classify(name, meta, row);
    // permission null = depends on input; the row's visibleWith stands in (design C5).
    const need = meta.permission ?? t.visibleWith;
    actions.push({
      kind: "task", action: name, label: t.label, mode: t.mode, groupId: t.groupId, module: t.module,
      roles: need ? ROLES.filter((r) => hasPermission(r, need)) : [], defaultOn: t.defaultOn, rule6: t.family !== undefined,
    });
  }

  const capabilities: CcCapability[] = CAPABILITY_KEYS.map((key) => {
    const cap = CAPABILITIES[key];
    const legacy = cap.legacyFeature ? isFeatureEnabled(ctx, cap.legacyFeature) : undefined;
    return {
      key, label: cap.label, description: cap.description, kind: cap.kind, groupId: groupIdFor(key), module: cap.module,
      roles: cap.roles.filter((r) => hasPermission(r, cap.permission)),
      defaultOn: ROLES.filter((r) => legacy ?? cap.roles.includes(r)),
    };
  });

  // Chat default with nothing stored for the role (legacy feature flag, else the role default).
  const bare = { ...ctx, institution: { ...ctx.institution, settings: { ...ctx.institution.settings, ai_roles: {} } } } as TenantContext;
  const roleEnabledDefault = Object.fromEntries(ROLES.map((r) => [r, roleAiConfig(bare, r).enabled])) as Record<Role, boolean>;

  return { actions, capabilities, roleEnabledDefault, killSwitch: orbTasksKilled() };
}

/** Only the stored keys the control centre edits, in the shape the pure state reads. */
export function ccSettings(s: Record<string, unknown>): CcSettings {
  const pick = (o: unknown): Record<string, boolean> =>
    typeof o === "object" && o !== null ? Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean> : {};
  return { modules: pick(s.modules), features: pick(s.features), ai_roles: (s.ai_roles ?? {}) as CcSettings["ai_roles"] };
}
