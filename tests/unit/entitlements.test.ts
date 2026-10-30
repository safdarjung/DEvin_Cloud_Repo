// D30 — per-institution feature entitlements.
import { describe, expect, it } from "vitest";
import { isFeatureEnabled } from "@/lib/auth/entitlements";
import type { TenantContext } from "@/lib/auth/types";

function ctxWithSettings(settings: Record<string, unknown>): TenantContext {
  return {
    institution: { id: "inst-1", slug: "demo", name: "Demo", settings, ai_policy: "local_only", is_demo: true },
    user: { id: "user-1", profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false } },
    membership: { role: "teacher", staffId: "staff-1", studentId: null, guardianId: null },
    permissions: new Set(),
  } as unknown as TenantContext;
}

describe("isFeatureEnabled", () => {
  it("is enabled when explicitly true", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { x: true } }), "x")).toBe(true);
  });

  it("is disabled only when explicitly false", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { x: false } }), "x")).toBe(false);
  });

  it("defaults to enabled when the key is missing from the features map", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { other: false } }), "x")).toBe(true);
  });

  it("defaults to enabled when settings has no features map at all", () => {
    expect(isFeatureEnabled(ctxWithSettings({}), "x")).toBe(true);
  });
});
