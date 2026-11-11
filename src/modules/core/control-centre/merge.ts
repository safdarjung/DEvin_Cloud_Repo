// One merge for a role's AI settings, used by core.ai_role.set (server) and the
// control centre's optimistic update (browser), so the two cannot drift.
import type { AiRoleConfig } from "../schemas.ts";

type Flags = Record<string, boolean | null>;
export type AiRolePatch = {
  enabled?: boolean;
  cloud?: boolean;
  instructions?: string;
  daily_token_quota?: number;
  capabilities?: Flags;
  modes?: Flags;
  groups?: Flags;
  tasks?: Flags;
};

const MAP_KEYS = ["capabilities", "modes", "groups", "tasks"] as const;

/** Override maps merge key-wise (a null removes that override, an emptied map is dropped); other fields replace. */
export function mergeRoleConfig(existing: AiRoleConfig | undefined, patch: AiRolePatch): AiRoleConfig {
  const base: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) if (!(MAP_KEYS as readonly string[]).includes(k)) base[k] = v;
  for (const key of MAP_KEYS) {
    const change = patch[key];
    if (!change) continue;
    const merged = Object.fromEntries(Object.entries({ ...(existing?.[key] as Flags | undefined), ...change }).filter(([, v]) => v !== null));
    if (Object.keys(merged).length > 0) base[key] = merged;
    else delete base[key];
  }
  return base as AiRoleConfig;
}
