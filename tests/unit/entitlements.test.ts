// D30/D33 — per-institution feature entitlements.
import { describe, expect, it } from "vitest";
import { FEATURE_CATALOG, isFeatureEnabled } from "@/lib/auth/entitlements";
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
    expect(isFeatureEnabled(ctxWithSettings({ features: { teacher_ai_agent: true } }), "teacher_ai_agent")).toBe(true);
  });

  it("is disabled when explicitly false, even for a key whose catalog default is true", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { teacher_ai_agent: false } }), "teacher_ai_agent")).toBe(false);
  });

  it("falls back to the catalog default (true) when the key is missing from the features map", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { student_ai_study: false } }), "teacher_ai_agent")).toBe(true);
  });

  it("falls back to the catalog default (false) when settings has no features map at all", () => {
    expect(isFeatureEnabled(ctxWithSettings({}), "student_ai_study")).toBe(false);
  });

  it("D33: a sub-feature is disabled while its parent is off, even if stored true", () => {
    const ctx = ctxWithSettings({ features: { teacher_ai_agent: false, teacher_ai_visuals: true } });
    expect(isFeatureEnabled(ctx, "teacher_ai_visuals")).toBe(false);
  });

  it("D33: a sub-feature follows its own stored value once its parent is on", () => {
    const ctx = ctxWithSettings({ features: { teacher_ai_agent: true, teacher_ai_visuals: true } });
    expect(isFeatureEnabled(ctx, "teacher_ai_visuals")).toBe(true);
  });

  it("D33: every key defaults off except teacher_ai_agent", () => {
    for (const [key, entry] of Object.entries(FEATURE_CATALOG)) {
      expect(entry.default).toBe(key === "teacher_ai_agent");
    }
  });
});
