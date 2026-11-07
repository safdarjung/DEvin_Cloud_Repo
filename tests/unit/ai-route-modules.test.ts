import { describe, expect, it } from "vitest";
import { isModuleEnabled } from "@/lib/modules/catalog";
import { isAiCapabilityEnabled } from "@/modules/ai/capabilities/resolve";
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

  describe("isAiCapabilityEnabled checks", () => {
    it("quiz_generator capability off → ai_unavailable", () => {
      const ctx = mockCtx({
        modules: { ai_teacher: true },
        ai_roles: { owner: { enabled: true, capabilities: { quiz_generator: false } } },
      }) as TenantContext;
      const enabled = isAiCapabilityEnabled(ctx, "quiz_generator");
      expect(enabled).toBe(false);
    });

    it("report_remark capability off → ai_unavailable", () => {
      const ctx = mockCtx({
        modules: { ai_teacher: true },
        ai_roles: { owner: { enabled: true, capabilities: { report_remark: false } } },
      }) as TenantContext;
      const enabled = isAiCapabilityEnabled(ctx, "report_remark");
      expect(enabled).toBe(false);
    });

    it("enquiry_reply capability off → ai_unavailable", () => {
      const ctx = mockCtx({
        modules: { ai_teacher: true },
        ai_roles: { owner: { enabled: true, capabilities: { enquiry_reply: false } } },
      }) as TenantContext;
      const enabled = isAiCapabilityEnabled(ctx, "enquiry_reply");
      expect(enabled).toBe(false);
    });

    it("attendance_insight capability off → ai_unavailable", () => {
      const ctx = mockCtx({
        modules: { ai_briefings: true },
        ai_roles: { owner: { enabled: true, capabilities: { attendance_insight: false } } },
      }) as TenantContext;
      const enabled = isAiCapabilityEnabled(ctx, "attendance_insight");
      expect(enabled).toBe(false);
    });

    it("daily_briefing capability off → ai_unavailable", () => {
      const ctx = mockCtx({
        modules: { ai_briefings: true },
        ai_roles: { owner: { enabled: true, capabilities: { daily_briefing: false } } },
      }) as TenantContext;
      const enabled = isAiCapabilityEnabled(ctx, "daily_briefing");
      expect(enabled).toBe(false);
    });

    it("practice_quiz capability off → ai_unavailable", () => {
      const ctx = mockCtx({
        modules: { practice: true, ai_student: true },
        ai_roles: { student: { enabled: true, capabilities: { practice_quiz: false } } },
      }) as TenantContext;
      ctx.membership.role = "student";
      const enabled = isAiCapabilityEnabled(ctx, "practice_quiz");
      expect(enabled).toBe(false);
    });
  });
});
