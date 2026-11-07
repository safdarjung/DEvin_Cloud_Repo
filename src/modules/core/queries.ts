// MOD-T4 — listModules: a pure projection of the module catalog for this
// institution, no DB round-trip (module state lives in ctx.institution.settings,
// already loaded by getTenantContext).
import { FEATURE_CATALOG, isFeatureEnabled, type FeatureKey } from "@/lib/auth/entitlements";
import { isModuleEnabled, MODULE_KEYS, MODULES, type ModuleCategory, type ModuleKey } from "@/lib/modules/catalog";
import type { TenantContext } from "@/lib/auth/types";

export interface ModuleOption {
  key: FeatureKey;
  label: string;
  enabled: boolean;
}

export interface ModuleListItem {
  key: ModuleKey;
  label: string;
  description: string;
  core: boolean;
  enabled: boolean;
  requires: ModuleKey[];
  options: ModuleOption[];
}

export interface ModuleCategoryGroup {
  category: ModuleCategory;
  modules: ModuleListItem[];
}

const CATEGORY_ORDER: ModuleCategory[] = [
  "Core",
  "Academics",
  "Exams",
  "Admissions & Website",
  "People & HR",
  "Finance+",
  "Operations",
  "Communication",
  "Reports",
  "AI",
  "Intelligence",
];

export function listModules(ctx: TenantContext): ModuleCategoryGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    modules: MODULE_KEYS.filter((key) => MODULES[key].category === category).map((key) => {
      // Same defensive read as setModuleEnabled (core/actions.ts) and
      // catalog.ts's own isModuleEnabled — a union of per-key literal types
      // has no shared `core`/`requires` property.
      const entry = MODULES[key] as Record<string, unknown>;
      // T6 (ai-roles) — AI feature toggles (teacher_ai_*/student_ai_*, both on
      // the ai_teacher/ai_student modules) moved to /settings/ai's per-role
      // capability switches; this page no longer lists them.
      const options = (Object.keys(FEATURE_CATALOG) as FeatureKey[])
        .filter((featureKey) => FEATURE_CATALOG[featureKey].module === key && key !== "ai_teacher" && key !== "ai_student")
        .map((featureKey) => ({
          key: featureKey,
          label: FEATURE_CATALOG[featureKey].label,
          enabled: isFeatureEnabled(ctx, featureKey),
        }));
      return {
        key,
        label: entry.label as string,
        description: entry.description as string,
        core: entry.core === true,
        enabled: isModuleEnabled(ctx, key),
        requires: [...((entry.requires as ModuleKey[] | undefined) ?? [])],
        options,
      };
    }),
  }));
}
