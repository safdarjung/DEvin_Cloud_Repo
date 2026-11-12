// D30/D33 — per-institution feature entitlements: what the platform gives
// this customer, orthogonal to `permissions.ts` (who within the institution
// can use it). Stored in `institutions.settings.features`, whose closed key
// set is owned by `InstitutionSettingsSchema` (src/modules/core/schemas.ts)
// — `FeatureKey` below is derived from it, never hand-duplicated, so a key
// added there without a matching `FEATURE_CATALOG` entry is a compile error.
import type { InstitutionSettings } from "@/modules/core/schemas";
import type { TenantContext } from "@/lib/auth/types";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules/catalog";

export type FeatureKey = keyof NonNullable<InstitutionSettings["features"]>;

interface FeatureCatalogEntry {
  /** Used only when the institution's settings have no explicit value for this key. */
  default: boolean;
  /** D33 — a sub-feature is never enabled while its parent is off, regardless of its own stored value. */
  parent?: FeatureKey;
  /** Module required for this feature to be enabled. */
  module: ModuleKey;
  /** Short plain label for UI display. */
  label: string;
}

// D33 defaulted these off; owner decision 2026-11-12 turns every AI feature on
// by default. A school can still switch any one off (stored false wins).
export const FEATURE_CATALOG: Record<FeatureKey, FeatureCatalogEntry> = {
  teacher_ai_agent: { default: true, module: "ai_teacher", label: "Agent" },
  teacher_ai_visuals: { default: true, parent: "teacher_ai_agent", module: "ai_teacher", label: "Visuals" },
  teacher_ai_class_insights: { default: true, parent: "teacher_ai_agent", module: "ai_teacher", label: "Class Insights" },
  teacher_ai_lesson_plans: { default: true, parent: "teacher_ai_agent", module: "ai_teacher", label: "Lesson Plans" },
  teacher_ai_parent_messages: { default: true, parent: "teacher_ai_agent", module: "ai_teacher", label: "Parent Messages" },
  student_ai_study: { default: true, module: "ai_student", label: "Study" },
  student_ai_visuals: { default: true, parent: "student_ai_study", module: "ai_student", label: "Visuals" },
  student_ai_notebook: { default: true, parent: "student_ai_study", module: "ai_student", label: "Notebook" },
};

export function isFeatureEnabled(ctx: TenantContext, key: FeatureKey): boolean {
  const entry = FEATURE_CATALOG[key];

  // Check module first
  if (!isModuleEnabled(ctx, entry.module)) return false;

  if (entry.parent && !isFeatureEnabled(ctx, entry.parent)) return false;

  const features = ctx.institution.settings.features;
  const stored = typeof features === "object" && features !== null ? (features as Record<string, unknown>)[key] : undefined;
  return typeof stored === "boolean" ? stored : entry.default;
}
