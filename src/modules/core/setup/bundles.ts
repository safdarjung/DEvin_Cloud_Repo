// F18 §H step 5 — recommended module bundles by student count, over the real
// catalog. Lists are ordered so a module's `requires` come before it.
import { MODULES, OPTIONAL_MODULE_KEYS, type OptionalModuleKey } from "@/lib/modules/catalog";

export type BundleTier = "small" | "medium" | "large";
export const BUNDLE_TIERS: readonly BundleTier[] = ["small", "medium", "large"];
export const SMALL_MAX = 300;
export const MEDIUM_MAX = 1000;

const SMALL: OptionalModuleKey[] = ["timetable", "exams", "announcements", "calendar", "diary", "certificates", "student_leave", "email"];
const MEDIUM: OptionalModuleKey[] = [...SMALL, "assignments", "lesson_plans", "admissions", "website", "finance_plus", "fee_plans", "staff_attendance", "sms", "ptm", "transport"];
const LARGE: OptionalModuleKey[] = [...MEDIUM, "online_payments", "messaging", "whatsapp", "student_lifecycle", "expenses", "payroll", "ai_teacher", "ai_student", "ai_briefings"];

export const BUNDLES: Record<BundleTier, readonly OptionalModuleKey[]> = { small: SMALL, medium: MEDIUM, large: LARGE };

export function recommendedTier(studentCount: number): BundleTier {
  return studentCount < SMALL_MAX ? "small" : studentCount < MEDIUM_MAX ? "medium" : "large";
}

export const bundleTotalInr = (tier: BundleTier): number => BUNDLES[tier].reduce((sum, key) => sum + MODULES[key].priceInr, 0);

/** What a brand-new school starts with: the small bundle on, every other optional module off (the owner adds more later). */
export function starterModules(): Record<OptionalModuleKey, boolean> {
  const on = new Set<OptionalModuleKey>(SMALL);
  return Object.fromEntries(OPTIONAL_MODULE_KEYS.map((key) => [key, on.has(key)])) as Record<OptionalModuleKey, boolean>;
}
