// D30 — per-institution feature entitlements: what the platform gives this
// customer, orthogonal to `permissions.ts` (who within the institution can
// use it). Stored in `institutions.settings.features` (reuses the existing
// jsonb column; no migration). A key missing or settings that fail to parse
// means enabled — only an explicit `false` disables a feature, so this can
// never silently take a feature away from an institution whose settings
// predate it.
import type { TenantContext } from "@/lib/auth/types";

export function isFeatureEnabled(ctx: TenantContext, feature: string): boolean {
  const features = ctx.institution.settings.features;
  if (typeof features !== "object" || features === null) return true;
  const flag = (features as Record<string, unknown>)[feature];
  return flag !== false;
}
