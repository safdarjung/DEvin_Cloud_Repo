// T3b (ai-roles) — migration 0108's ai_usage_events.role column: logUsage
// writes it, checkLimits adds a per-role daily cap read straight off
// settings.ai_roles[role].daily_token_quota (no resolver import, per
// BRIEF), and the new ai.usageByRole query aggregates 30-day tokens/cost
// per role under the caller's own RLS. Mirrors tests/db/ai-usage.test.ts
// (role quota) and tests/db/library-queries.test.ts (callAs forbidden case).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext, callAs, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { checkLimits, logUsage } from "@/lib/ai/usage";
import { usageByRole } from "@/modules/ai/queries";
import { usageByRoleQuery } from "@/modules/ai/query-defs";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

async function setAiRoles(institutionId: string, aiRoles: Record<string, { daily_token_quota: number }>): Promise<void> {
  await sql`
    update public.institutions set settings = settings || ${sql.json({ ai_roles: aiRoles })}
    where id = ${institutionId}
  `;
}

describe("ai_usage_events.role (T3b)", () => {
  it("logUsage stores the calling membership's role", async () => {
    const inst = await createTestInstitution("ai-usage-role-log");
    try {
      const ctx = await buildContext(inst, "teacher");
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

      const [row] = await sql`
        select role from public.ai_usage_events where institution_id = ${inst.institutionId}
      `;
      expect(row?.role).toBe("teacher");
    } finally {
      await inst.cleanup();
    }
  });

  it("checkLimits returns quota_exceeded once a role's own daily cap is reached, even though the institution-wide quota is nowhere close", async () => {
    const inst = await createTestInstitution("ai-usage-role-quota");
    try {
      await setAiRoles(inst.institutionId, { teacher: { daily_token_quota: 50 } });
      const ctx = await buildContext(inst, "teacher");

      await logUsage({
        ctx,
        feature: "quiz",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 30,
        outputTokens: 30,
        latencyMs: 50,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      const result = await checkLimits(ctx, "quiz");
      expect(result).toEqual({ ok: false, code: "quota_exceeded" });
    } finally {
      await inst.cleanup();
    }
  });

  it("a role's cap does not apply to a different role's usage", async () => {
    const inst = await createTestInstitution("ai-usage-role-quota-isolated");
    try {
      await setAiRoles(inst.institutionId, { teacher: { daily_token_quota: 50 } });
      const teacherCtx = await buildContext(inst, "teacher");
      await logUsage({
        ctx: teacherCtx,
        feature: "quiz",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 60,
        outputTokens: 0,
        latencyMs: 50,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      // admin has no configured cap — unaffected by the teacher cap above.
      const adminCtx = await buildContext(inst, "admin");
      const result = await checkLimits(adminCtx, "quiz");
      expect(result).toEqual({ ok: true });
    } finally {
      await inst.cleanup();
    }
  });

  it("checkLimits ignores settings.ai_roles when the caller's own role has no configured quota", async () => {
    const inst = await createTestInstitution("ai-usage-role-no-quota");
    try {
      await setAiRoles(inst.institutionId, { admin: { daily_token_quota: 10 } });
      const ctx = await buildContext(inst, "teacher");

      await logUsage({
        ctx,
        feature: "quiz",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 1000,
        outputTokens: 0,
        latencyMs: 50,
        costEstimateUsd: 0,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      const result = await checkLimits(ctx, "quiz");
      expect(result).toEqual({ ok: true });
    } finally {
      await inst.cleanup();
    }
  });
});

describe("ai.usageByRole (T3b)", () => {
  it("sums 30-day tokens and cost_paise per role, readable by owner under RLS", async () => {
    const inst = await createTestInstitution("ai-usage-by-role");
    try {
      const teacherCtx = await buildContext(inst, "teacher");
      const studentCtx = await buildContext(inst, "student");

      await logUsage({
        ctx: teacherCtx,
        feature: "quiz",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 50,
        costEstimateUsd: 0.01,
        ok: true,
        errorCode: null,
        redactions: 0,
      });
      await logUsage({
        ctx: studentCtx,
        feature: "student_study",
        provider: "local",
        model: "qwen3:4b-instruct-2507-q4_K_M",
        inputTokens: 20,
        outputTokens: 10,
        latencyMs: 50,
        costEstimateUsd: 0.005,
        ok: true,
        errorCode: null,
        redactions: 0,
      });

      const ownerCtx = await buildContext(inst, "owner");
      setActingClient(inst.clientAs("owner"));
      try {
        const rows = await usageByRole(ownerCtx);
        const teacherRow = rows.find((r) => r.role === "teacher");
        const studentRow = rows.find((r) => r.role === "student");

        expect(teacherRow?.tokens).toBe(150);
        expect(teacherRow?.cost_paise).toBe(84); // 0.01 USD x 8400 paise/USD
        expect(studentRow?.tokens).toBe(30);
        expect(studentRow?.cost_paise).toBe(42); // 0.005 USD x 8400 paise/USD
      } finally {
        setActingClient(null);
      }
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher calling ai.usageByRole -> forbidden (ai.usage.read is owner/principal/admin only)", async () => {
    const inst = await createTestInstitution("ai-usage-by-role-forbidden");
    try {
      const result = await callAs(inst, "teacher", usageByRoleQuery, {});
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
