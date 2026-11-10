// DBT-159 — migration 0112: SQL aggregates are not capped at PostgREST max_rows (1000).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { buildContext, closeActionsHelper } from "../helpers/actions";
import { closeRolesHelper, createTestInstitution } from "../helpers/roles";
import { setActingClient } from "../helpers/server-client-mock";
import { DEFAULT_INSTITUTION_SETTINGS } from "@/modules/core/schemas";
import { checkLimits } from "@/lib/ai/usage";
import { usageByRole, usageSummary } from "@/modules/ai/queries";

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeRolesHelper();
});

const EVENTS = 1200;

async function seedEvents(institutionId: string, userId: string) {
  await sql`
    insert into public.ai_usage_events
      (institution_id, user_id, role, feature, provider, model, input_tokens, output_tokens, latency_ms, cost_estimate_usd, ok, created_at)
    select ${institutionId}::uuid, ${userId}::uuid, 'teacher', 'quiz',
           case when g % 2 = 0 then 'local' else 'cloud' end, 'm', 10, 5, 1, 0.001, g % 3 <> 0, now() - interval '90 seconds'
    from generate_series(1, ${EVENTS}) g
  `;
}

describe("ai usage aggregates (0112)", () => {
  it("usageSummary and usageByRole sum all events past 1000 rows", async () => {
    const inst = await createTestInstitution("ai-usage-agg");
    try {
      const ctx = await buildContext(inst, "owner");
      await seedEvents(inst.institutionId, inst.users.teacher.id);
      setActingClient(inst.clientAs("owner"));

      const summary = await usageSummary(ctx);
      expect(summary.totalRequests).toBe(EVENTS);
      expect(summary.totalTokens).toBe(EVENTS * 15);
      expect(summary.byProvider.local.requests + summary.byProvider.cloud.requests).toBe(EVENTS);
      expect(summary.byProvider.local.okRequests + summary.byProvider.cloud.okRequests).toBe(EVENTS - EVENTS / 3);
      expect(summary.totalCostEstimateUsd).toBeCloseTo(EVENTS * 0.001, 5);

      const byRole = await usageByRole(ctx);
      expect(byRole).toEqual([{ role: "teacher", tokens: EVENTS * 15, cost_paise: Math.round(EVENTS * 0.001 * 8400) }]);
    } finally {
      await inst.cleanup();
    }
  });

  it("checkLimits sees tokens beyond the first 1000 events (quota boundary)", async () => {
    const inst = await createTestInstitution("ai-usage-agg-limit");
    try {
      const ctx = await buildContext(inst, "teacher");
      await seedEvents(inst.institutionId, inst.users.teacher.id);
      // 1200 * 15 = 18000 tokens today; a 1000-row cap would see only 15000.
      const withQuota = (daily: number) => ({
        ...ctx,
        institution: {
          ...ctx.institution,
          settings: { ai: { ...DEFAULT_INSTITUTION_SETTINGS.ai, daily_token_quota: daily } },
        },
      });
      expect(await checkLimits(withQuota(17_000), "quiz")).toEqual({ ok: false, code: "quota_exceeded" });
      expect(await checkLimits(withQuota(19_000), "quiz")).toEqual({ ok: true });
    } finally {
      await inst.cleanup();
    }
  });
});
