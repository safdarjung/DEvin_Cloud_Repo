// T1b (ai-roles) — resolves the per-role AI config and per-capability on/off
// state from `institutions.settings.ai_roles` (schemas.ts) plus the legacy
// feature flags (entitlements.ts) that already governed this behavior
// before this settings page existed. Config can only NARROW what
// permissions.ts already allows — see catalog.ts's header comment.
import { hasPermission, type Role } from "@/lib/auth/permissions";
import type { TenantContext } from "@/lib/auth/types";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import { isModuleEnabled } from "@/lib/modules/catalog";
import type { AiRoleConfig } from "@/modules/core/schemas";
import { groupIdFor } from "@/modules/ai/components/orb/orb-groups";
import { SECTIONS } from "@/modules/ai/components/orb/orb-modes";
import { CAPABILITIES, CAPABILITY_KEYS, type CapabilityKey } from "./catalog";

export interface ResolvedRoleAiConfig {
  enabled: boolean;
  cloud: boolean;
  instructions: string;
  dailyTokenQuota: number | null;
}

export type CapabilityLock = null | "role" | "permission" | "module" | "role_off" | "mode_off" | "group_off";

export interface CapabilityState {
  on: boolean;
  locked: CapabilityLock;
  /** Why it is off, for mode/group switches (control centre). */
  reason?: string;
}

// Roles whose overall AI switch has no legacy feature flag behind it
// default to true; teacher/student instead fall back to their existing
// flag (LEGACY_ENABLED_FEATURE) when nothing is stored yet.
const DEFAULT_ENABLED_ROLES: readonly Role[] = ["owner", "principal", "admin", "admissions"];

const LEGACY_ENABLED_FEATURE: Partial<Record<Role, "teacher_ai_agent" | "student_ai_study">> = {
  teacher: "teacher_ai_agent",
  student: "student_ai_study",
};

// Defensive read, same pattern as isModuleEnabled/isFeatureEnabled: settings
// is an untyped Record until the Zod schema runs on write, so never trust
// its shape on read.
function storedRoleConfig(ctx: TenantContext, role: Role): Partial<AiRoleConfig> {
  const settings = ctx.institution.settings;
  const aiRoles = typeof settings === "object" && settings !== null ? (settings as Record<string, unknown>).ai_roles : undefined;
  const stored = typeof aiRoles === "object" && aiRoles !== null ? (aiRoles as Record<string, unknown>)[role] : undefined;
  return typeof stored === "object" && stored !== null ? (stored as Partial<AiRoleConfig>) : {};
}

export function roleAiConfig(ctx: TenantContext, role: Role): ResolvedRoleAiConfig {
  const stored = storedRoleConfig(ctx, role);
  const legacyKey = LEGACY_ENABLED_FEATURE[role];

  const enabled =
    typeof stored.enabled === "boolean"
      ? stored.enabled
      : legacyKey
        ? isFeatureEnabled(ctx, legacyKey)
        : DEFAULT_ENABLED_ROLES.includes(role);

  return {
    enabled,
    cloud: typeof stored.cloud === "boolean" ? stored.cloud : true,
    instructions: typeof stored.instructions === "string" ? stored.instructions : "",
    dailyTokenQuota: typeof stored.daily_token_quota === "number" ? stored.daily_token_quota : null,
  };
}

export function capabilityState(ctx: TenantContext, role: Role, key: CapabilityKey): CapabilityState {
  const cap = CAPABILITIES[key];

  if (!cap.roles.includes(role)) return { on: false, locked: "role" };
  if (!hasPermission(role, cap.permission)) return { on: false, locked: "permission" };
  if (!isModuleEnabled(ctx, cap.module)) return { on: false, locked: "module" };
  // `enabled` is the role's AI chat switch: it locks chat tools only. Page
  // tasks (quiz generator, report remark, practice quiz, ...) keep their own
  // switch, so turning a role's chat off never removes a task it has today.
  if (cap.kind === "chat_tool" && !roleAiConfig(ctx, role).enabled) return { on: false, locked: "role_off" };

  // Orb control centre switches (narrowing only; both default on): a chat tool
  // sits in Ask, a page task in Create, each in its orb group.
  const config = storedRoleConfig(ctx, role);
  const mode = cap.kind === "chat_tool" ? "ask" : "create";
  if (config.modes?.[mode] === false) return { on: false, locked: "mode_off", reason: `${mode === "ask" ? "Ask" : "Create"} mode is off for this role.` };
  const group = groupIdFor(key);
  if (config.groups?.[group] === false) return { on: false, locked: "group_off", reason: `The ${SECTIONS[group].label} group is off for this role.` };

  const stored = config.capabilities?.[key];
  const legacy = cap.legacyFeature ? isFeatureEnabled(ctx, cap.legacyFeature) : undefined;
  const on = typeof stored === "boolean" ? stored : legacy ?? cap.defaultOn.includes(role);
  return { on, locked: null };
}

export function enabledCapabilities(ctx: TenantContext, role: Role = ctx.membership.role): readonly CapabilityKey[] {
  return CAPABILITY_KEYS.filter((key) => capabilityState(ctx, role, key).on);
}

export function isAiCapabilityEnabled(ctx: TenantContext, key: CapabilityKey): boolean {
  return capabilityState(ctx, ctx.membership.role, key).on;
}

/**
 * T7 — "Test as role" preview: the previewed role's enabled chat tools,
 * intersected with the caller's own permission floor (`hasPermission`,
 * never the previewed role's). `data: "own"` capabilities are dropped
 * outright — a preview has no own student/child record to scope them to.
 */
export function previewEnabledCapabilities(ctx: TenantContext, previewRole: Role, callerRole: Role): readonly CapabilityKey[] {
  return enabledCapabilities(ctx, previewRole).filter((key) => {
    const cap = CAPABILITIES[key];
    return cap.kind === "chat_tool" && cap.data !== "own" && hasPermission(callerRole, cap.permission);
  });
}
