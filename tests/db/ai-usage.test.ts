import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createTestInstitution, type TestInstitution } from "../helpers/roles";
import { checkLimits, logUsage } from "@/lib/ai/usage";
import type { TenantContext } from "@/lib/auth/types";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
});

function fakeCtx(fixture: TestInstitution, role: "owner" | "teacher" | "student", settings: Record<string, unknown> = {}): TenantContext {
  return {
    institution: {
      id: fixture.institutionId,
      slug: fixture.slug,
      name: fixture.slug,
      settings,
      ai_policy: "local_only",
      is_demo: true,
    },
    user: {
      id: fixture.users[role].id,
      profile: { fullName: null, phone: null, avatarPath: null, isPlatformAdmin: false },
    },
    membership: { role, staffId: null, guardianId: null, studentId: null },
    permissions: new Set(),
  };
}

describe("ai_usage_events (T-035)", () => {
  it("C-64: logUsage stores metadata only; RLS exposes it to owner/admin, not teacher", async () => {
    const fixture = await createTestInstitution("ai-usage-c64");
    try {
      const ctx = fakeCtx(fixture, "teacher");

      await logUsage({
        ctx,
        feature: "quiz",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 120,
        outputTokens: 80,
        latencyMs: 450,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      const [row] = await sql`
        select * from public.ai_usage_events where institution_id = ${fixture.institutionId}
      `;
      expect(row).toBeDefined();
      expect(Object.keys(row).sort()).toEqual(
        [
          "cost_estimate_usd",
          "created_at",
          "error_code",
          "feature",
          "id",
          "input_tokens",
          "institution_id",
          "latency_ms",
          "model",
          "ok",
          "output_tokens",
          "provider",
          "redactions",
          "user_id",
        ].sort(),
      );
      expect(row.input_tokens).toBe(120);
      expect(row.output_tokens).toBe(80);

      const { data: asOwner, error: ownerError } = await fixture
        .clientAs("owner")
        .from("ai_usage_events")
        .select("id")
        .eq("institution_id", fixture.institutionId);
      expect(ownerError).toBeNull();
      expect(asOwner).toHaveLength(1);

      const { data: asTeacher, error: teacherError } = await fixture
        .clientAs("teacher")
        .from("ai_usage_events")
        .select("id")
        .eq("institution_id", fixture.institutionId);
      expect(teacherError).toBeNull();
      expect(asTeacher).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("checkLimits returns quota_exceeded once today's token sum reaches the institution's daily quota", async () => {
    const fixture = await createTestInstitution("ai-usage-quota");
    try {
      const ctx = fakeCtx(fixture, "teacher", {
        ai: { daily_token_quota: 100, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4, student_daily_token_quota: 100 },
      });

      await logUsage({
        ctx,
        feature: "quiz",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 60,
        outputTokens: 60,
        latencyMs: 100,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      const result = await checkLimits(ctx, "quiz");
      expect(result).toEqual({ ok: false, code: "quota_exceeded" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("checkLimits returns rate_limited on the (per_user_per_minute + 1)th request in a minute", async () => {
    const fixture = await createTestInstitution("ai-usage-rate");
    try {
      const ctx = fakeCtx(fixture, "teacher", {
        ai: { daily_token_quota: 200000, per_user_per_minute: 3, max_concurrent_local: 2, max_concurrent_cloud: 4, student_daily_token_quota: 20000 },
      });

      for (let i = 0; i < 3; i++) {
        await logUsage({
          ctx,
          feature: "quiz",
          provider: "local",
          model: "qwen3:4b-instruct-2507-q4_K_M",
          inputTokens: 10,
          outputTokens: 10,
          latencyMs: 50,
          costEstimateUsd: 0,
          ok: true,
          errorCode: null,
          redactions: 0,
        });
      }

      const result = await checkLimits(ctx, "quiz");
      expect(result).toEqual({ ok: false, code: "rate_limited" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("checkLimits returns ok when under both limits", async () => {
    const fixture = await createTestInstitution("ai-usage-ok");
    try {
      const ctx = fakeCtx(fixture, "teacher", {
        ai: { daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4, student_daily_token_quota: 20000 },
      });

      const result = await checkLimits(ctx, "quiz");
      expect(result).toEqual({ ok: true });
    } finally {
      await fixture.cleanup();
    }
  });

  // GU-08 security review (H1) — one student must not be able to exhaust
  // the institution-wide quota; the per-student cap is checked in
  // addition to it, only for `feature: "student_study"`.
  it("checkLimits returns quota_exceeded for student_study once a single student's own usage reaches student_daily_token_quota, even though the institution-wide quota is nowhere close", async () => {
    const fixture = await createTestInstitution("ai-usage-student-quota");
    try {
      const ctx = fakeCtx(fixture, "student", {
        ai: { daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4, student_daily_token_quota: 50 },
      });

      await logUsage({
        ctx,
        feature: "student_study",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 30,
        outputTokens: 30,
        latencyMs: 100,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      const result = await checkLimits(ctx, "student_study");
      expect(result).toEqual({ ok: false, code: "quota_exceeded" });
    } finally {
      await fixture.cleanup();
    }
  });

  it("the per-student cap does not apply to a non-student_study feature", async () => {
    const fixture = await createTestInstitution("ai-usage-student-quota-other-feature");
    try {
      const ctx = fakeCtx(fixture, "student", {
        ai: { daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4, student_daily_token_quota: 50 },
      });

      await logUsage({
        ctx,
        feature: "student_study",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 60,
        outputTokens: 0,
        latencyMs: 100,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      // The student is over their student_study cap, but a different
      // feature (hypothetically available to them) isn't gated by it.
      const result = await checkLimits(ctx, "quiz");
      expect(result).toEqual({ ok: true });
    } finally {
      await fixture.cleanup();
    }
  });

  it("one student's usage does not count against a different student's cap", async () => {
    const fixture = await createTestInstitution("ai-usage-student-quota-isolated");
    try {
      const studentCtx = fakeCtx(fixture, "student", {
        ai: { daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4, student_daily_token_quota: 50 },
      });
      await logUsage({
        ctx: studentCtx,
        feature: "student_study",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 60,
        outputTokens: 0,
        latencyMs: 100,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      // Same institution, different user (teacher fixture user) — their
      // own student_study usage (hypothetical) starts from zero.
      const teacherAsStudentFeatureCtx = fakeCtx(fixture, "teacher", {
        ai: { daily_token_quota: 200000, per_user_per_minute: 10, max_concurrent_local: 2, max_concurrent_cloud: 4, student_daily_token_quota: 50 },
      });
      const result = await checkLimits(teacherAsStudentFeatureCtx, "student_study");
      expect(result).toEqual({ ok: true });
    } finally {
      await fixture.cleanup();
    }
  });
});
