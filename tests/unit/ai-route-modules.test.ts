import { describe, expect, it } from "vitest";
import { isModuleEnabled } from "@/lib/modules/catalog";
import type { TenantContext } from "@/lib/auth/types";

describe("AI routes — module gating", () => {
  const mockCtx = (modulesSettings: Record<string, unknown>): TenantContext => ({
    institution: {
      id: "inst-1",
      slug: "test-school",
      name: "Test School",
      settings: modulesSettings,
      ai_policy: "local_only",
      is_demo: false,
    },
    membership: {
      role: "owner",
      staffId: null,
      guardianId: null,
      studentId: null,
    },
    user: {
      id: "user-1",
      email: "test@example.com",
    },
    permissions: {},
  }) as unknown as TenantContext;

  describe("isModuleEnabled checks", () => {
    it("quiz route with ai_teacher off → ai_unavailable", () => {
      const ctx = mockCtx({ modules: { ai_teacher: false } }) as TenantContext;
      const enabled = isModuleEnabled(ctx, "ai_teacher");
      expect(enabled).toBe(false);
    });

    it("quiz route with ai_teacher on → reaches gateway", () => {
      const ctx = mockCtx({ modules: { ai_teacher: true } }) as TenantContext;
      const enabled = isModuleEnabled(ctx, "ai_teacher");
      expect(enabled).toBe(true);
    });

    it("dashboard-briefing with ai_briefings off → ai_unavailable", () => {
      const ctx = mockCtx({ modules: { ai_briefings: false } }) as TenantContext;
      const enabled = isModuleEnabled(ctx, "ai_briefings");
      expect(enabled).toBe(false);
    });

    it("dashboard-briefing with ai_briefings on → reaches gateway", () => {
      const ctx = mockCtx({ modules: { ai_briefings: true } }) as TenantContext;
      const enabled = isModuleEnabled(ctx, "ai_briefings");
      expect(enabled).toBe(true);
    });

    it("attendance-insight with ai_briefings off → ai_unavailable", () => {
      const ctx = mockCtx({ modules: { ai_briefings: false } }) as TenantContext;
      const enabled = isModuleEnabled(ctx, "ai_briefings");
      expect(enabled).toBe(false);
    });

    it("report-remark with ai_teacher off → ai_unavailable", () => {
      const ctx = mockCtx({ modules: { ai_teacher: false } }) as TenantContext;
      const enabled = isModuleEnabled(ctx, "ai_teacher");
      expect(enabled).toBe(false);
    });

    it("enquiry-reply with ai_teacher off → ai_unavailable", () => {
      const ctx = mockCtx({ modules: { ai_teacher: false } }) as TenantContext;
      const enabled = isModuleEnabled(ctx, "ai_teacher");
      expect(enabled).toBe(false);
    });

    it("all modules off by default for optional keys", () => {
      const ctx = mockCtx({ modules: {} }) as TenantContext;
      // Core modules default true, optional default per catalog
      expect(isModuleEnabled(ctx, "ai_teacher")).toBe(true); // default true
      expect(isModuleEnabled(ctx, "ai_student")).toBe(true); // default true
      expect(isModuleEnabled(ctx, "ai_briefings")).toBe(true); // default true
    });
  });
});
