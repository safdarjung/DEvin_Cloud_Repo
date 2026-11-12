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
    expect(isFeatureEnabled(ctxWithSettings({ features: { teacher_ai_agent: true }, modules: { ai_teacher: true } }), "teacher_ai_agent")).toBe(true);
  });

  it("is disabled when explicitly false, even for a key whose catalog default is true", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { teacher_ai_agent: false }, modules: { ai_teacher: true } }), "teacher_ai_agent")).toBe(false);
  });

  it("falls back to the catalog default (true) when the key is missing from the features map", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { student_ai_study: false }, modules: { ai_teacher: true } }), "teacher_ai_agent")).toBe(true);
  });

  it("falls back to the catalog default (true) when settings has no features map at all", () => {
    expect(isFeatureEnabled(ctxWithSettings({ modules: { ai_student: true } }), "student_ai_study")).toBe(true);
  });

  it("D33: a sub-feature is disabled while its parent is off, even if stored true", () => {
    const ctx = ctxWithSettings({ features: { teacher_ai_agent: false, teacher_ai_visuals: true }, modules: { ai_teacher: true } });
    expect(isFeatureEnabled(ctx, "teacher_ai_visuals")).toBe(false);
  });

  it("D33: a sub-feature follows its own stored value once its parent is on", () => {
    const ctx = ctxWithSettings({ features: { teacher_ai_agent: true, teacher_ai_visuals: true }, modules: { ai_teacher: true } });
    expect(isFeatureEnabled(ctx, "teacher_ai_visuals")).toBe(true);
  });

  it("every AI feature key defaults on (owner decision 2026-11-12, replaces D33's default-off)", () => {
    for (const entry of Object.values(FEATURE_CATALOG)) {
      expect(entry.default).toBe(true);
    }
  });

  it("teacher_ai_agent is false when ai_teacher module is off although the feature is stored true", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { teacher_ai_agent: true }, modules: { ai_teacher: false } }), "teacher_ai_agent")).toBe(false);
  });

  it("student_ai_study is false when ai_student module is off although the feature is stored true", () => {
    expect(isFeatureEnabled(ctxWithSettings({ features: { student_ai_study: true }, modules: { ai_student: false } }), "student_ai_study")).toBe(false);
  });
});
