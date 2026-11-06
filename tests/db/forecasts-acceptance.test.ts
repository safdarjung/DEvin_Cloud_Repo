// M21-T11 — forecasts acceptance over HTTP (M21-tasks.md Task 11). Seeds
// real history, runs the real sweep (`enqueue_due_forecasts`) + one
// `runOnceCore` pass (same pattern as announcements-acceptance.test.ts),
// then exercises forecasts.cards / forecasts.list via /api/v1/query for
// every role the rulings name, plus the module-disabled gate (own fixture
// institution — finance-completion-acceptance.test.ts's getTenantContext()
// cache-staleness note).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { GET as queryGet } from "@/app/api/v1/query/[name]/route";
import { closeForecastFixturesHelper, seedForecastHistory } from "../helpers/forecast-fixtures";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";
import { withoutSweeps } from "../helpers/runner-ports";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const { createRunnerPorts, runOnceCore } = await import("@/modules/jobs/runner");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

function queryUrl(name: string, institution: string, input: unknown): URL {
  const url = new URL(`http://localhost/api/v1/query/${name}`);
  url.searchParams.set("institution", institution);
  url.searchParams.set("input", JSON.stringify(input));
  return url;
}

function dispatchQuery(name: string, institution: string, input: unknown, headers: Record<string, string>): Promise<Response> {
  return queryGet(new Request(queryUrl(name, institution, input), { headers }), { params: Promise.resolve({ name }) });
}

function authHeader(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function tokenFor(inst: TestInstitution, role: Parameters<TestInstitution["clientAs"]>[0]): Promise<string> {
  const { data, error } = await inst.clientAs(role).auth.getSession();
  if (error || !data.session) throw error ?? new Error(`no session for ${role}`);
  return data.session.access_token;
}

/** MOD's mechanism (same direct-settings-patch shape as visitors-acceptance.test.ts's module-off test). */
async function setModuleEnabledDirect(institutionId: string, key: string, enabled: boolean): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(settings, array['modules', ${key}], ${sql.json(enabled)})
    where id = ${institutionId}
  `;
}

async function taughtSectionId(institutionId: string): Promise<string> {
  const [row] = await sql`
    select cs.id from public.class_sections cs
    join public.grades g on g.id = cs.grade_id
    where cs.institution_id = ${institutionId} and g.code = 'FC'
  `;
  return row.id as string;
}

afterAll(async () => {
  await sql.end();
  await closeForecastFixturesHelper();
  await closeRolesHelper();
});

describe("M21 forecasts acceptance: sweep + runner produce real forecasts, served over HTTP per role", () => {
  it(
    "enqueue_due_forecasts + runOnceCore -> forecast.run succeeded, every forecast has a backtest; principal cards " +
      "(confidence = 1-mape of the selected backtest); accountant fee-card-only; teacher list own-section-only; guardian forbidden",
    async () => {
      const inst = await createTestInstitution("forecasts-acceptance");
      try {
        await seedForecastHistory(inst);

        // --- real sweep (service role, default p_now) -----------------
        const { error: sweepError } = await admin.rpc("enqueue_due_forecasts");
        expect(sweepError).toBeNull();

        // --- one runner pass with real ports (announcements-acceptance.test.ts pattern) ---
        const summary = await runOnceCore({ workerId: "test-worker-forecasts-acceptance" }, withoutSweeps(createRunnerPorts(admin), ["enqueueDueForecasts"]));
        expect(summary.succeeded).toBeGreaterThanOrEqual(1);
        expect(summary.dead).toBe(0);

        const [jobRow] = await sql`
          select status from public.jobs where institution_id = ${inst.institutionId}::uuid and type = 'forecast.run'
        `;
        expect(jobRow.status).toBe("succeeded");

        // --- backtest + forecast rows exist; every forecast has a backtest ---
        const backtests = await sql`select id, series_key, model, mape from public.forecast_backtests where institution_id = ${inst.institutionId}::uuid`;
        expect(backtests.length).toBeGreaterThan(0);
        const forecasts = await sql`
          select f.series_key, f.horizon, f.confidence, b.mape
          from public.forecasts f
          join public.forecast_backtests b on b.id = f.backtest_id
          where f.institution_id = ${inst.institutionId}::uuid
        `;
        expect(forecasts.length).toBeGreaterThan(0);
        const [orphans] = await sql`
          select count(*)::int as n from public.forecasts where institution_id = ${inst.institutionId}::uuid and backtest_id is null
        `;
        expect(orphans.n).toBe(0);

        // --- principal: forecasts.cards -> 2 cards, confidence = 1-mape (clamped) ---
        const principalAuth = authHeader(await tokenFor(inst, "principal"));
        const cardsRes = await dispatchQuery("forecasts.cards", inst.slug, {}, principalAuth);
        expect(cardsRes.status).toBe(200);
        const cardsBody = await cardsRes.json();
        expect(cardsBody.ok).toBe(true);
        expect(cardsBody.data).toHaveLength(2);
        expect(cardsBody.data[0].metric).toBe("Attendance Rate");
        expect(cardsBody.data[1].metric).toBe("Fee Collection");
        for (const [seriesKey, card] of [
          ["attendance:school", cardsBody.data[0]],
          ["fees:term", cardsBody.data[1]],
        ] as const) {
          const horizon1 = forecasts.find((r) => r.series_key === seriesKey && r.horizon === 1)!;
          expect(horizon1).toBeDefined();
          const expectedConfidence = Math.max(0, Math.min(1, 1 - Number(horizon1.mape)));
          expect(card.confidence).toBeCloseTo(expectedConfidence, 2);
          expect(card.confidence).toBeCloseTo(Number(horizon1.confidence), 6);
        }

        // --- accountant: fee card only (RLS hides attendance_rate_week) ---
        const accountantAuth = authHeader(await tokenFor(inst, "accountant"));
        const accountantCardsRes = await dispatchQuery("forecasts.cards", inst.slug, {}, accountantAuth);
        expect(accountantCardsRes.status).toBe(200);
        const accountantCardsBody = await accountantCardsRes.json();
        expect(accountantCardsBody.ok).toBe(true);
        expect(accountantCardsBody.data).toHaveLength(1);
        expect(accountantCardsBody.data[0].metric).toBe("Fee Collection");

        // --- teacher: forecasts.list -> own section only -----------------
        const sectionId = await taughtSectionId(inst.institutionId);
        const teacherAuth = authHeader(await tokenFor(inst, "teacher"));
        const teacherListRes = await dispatchQuery("forecasts.list", inst.slug, {}, teacherAuth);
        expect(teacherListRes.status).toBe(200);
        const teacherListBody = await teacherListRes.json();
        expect(teacherListBody.ok).toBe(true);
        expect((teacherListBody.data as Array<{ classSectionId: string | null }>).length).toBeGreaterThan(0);
        for (const row of teacherListBody.data as Array<{ classSectionId: string | null; seriesKey: string }>) {
          expect(row.classSectionId).toBe(sectionId);
          expect(row.seriesKey).toBe(`attendance:section:${sectionId}`);
        }

        // --- guardian: forecasts.list -> 403 forbidden (no forecast.read permission) ---
        const guardianAuth = authHeader(await tokenFor(inst, "guardian"));
        const guardianListRes = await dispatchQuery("forecasts.list", inst.slug, {}, guardianAuth);
        expect(guardianListRes.status).toBe(403);
        const guardianListBody = await guardianListRes.json();
        expect(guardianListBody.ok).toBe(false);
        expect(guardianListBody.error.code).toBe("forbidden");
      } finally {
        await inst.cleanup();
      }
    },
  );

  it("module disabled: principal forecasts.cards -> 403 MODULE_DISABLED_MESSAGE; a queued forecast.run completes succeeded with no new rows", async () => {
    // Dedicated, never-before-dispatched slug (visitors-acceptance.test.ts's
    // note): disabling the module before this slug's first HTTP call avoids
    // getTenantContext() cache() staleness.
    const inst = await createTestInstitution("forecasts-module-off");
    try {
      await setModuleEnabledDirect(inst.institutionId, "forecasts", false);
      const principalAuth = authHeader(await tokenFor(inst, "principal"));

      const cardsRes = await dispatchQuery("forecasts.cards", inst.slug, {}, principalAuth);
      expect(cardsRes.status).toBe(403);
      const cardsBody = await cardsRes.json();
      expect(cardsBody.ok).toBe(false);
      expect(cardsBody.error.code).toBe("forbidden");
      const { MODULE_DISABLED_MESSAGE } = await import("@/lib/modules/catalog");
      expect(cardsBody.error.message).toBe(MODULE_DISABLED_MESSAGE);

      // Directly enqueue (bypasses enqueue_due_forecasts' own module_enabled
      // filter — this proves the runner's dispatch-time JOB_MODULES gate,
      // mirrors tests/db/module-jobs-channels.test.ts's MOD-T11 pattern).
      const [beforeBacktests] = await sql`select count(*)::int as n from public.forecast_backtests where institution_id = ${inst.institutionId}::uuid`;
      const [beforeForecasts] = await sql`select count(*)::int as n from public.forecasts where institution_id = ${inst.institutionId}::uuid`;
      const key = `forecast-module-off-${crypto.randomUUID()}`;
      await sql`select app.enqueue_job(${inst.institutionId}::uuid, 'forecast.run', ${sql.json({ as_of: "2026-01-01" })}, ${key})`;

      const ports = withoutSweeps(createRunnerPorts(admin), ["enqueueDueForecasts"]);
      const job = await ports.claimJob(`test-worker-forecasts-module-off-${crypto.randomUUID()}`);
      expect(job?.idempotency_key).toBe(key);
      if (!job) return;
      await expect(ports.dispatch(job)).resolves.toBeUndefined();
      await ports.completeJob(job.id, true);

      const [jobRow] = await sql`select status from public.jobs where id = ${job.id}::uuid`;
      expect(jobRow.status).toBe("succeeded");

      const [afterBacktests] = await sql`select count(*)::int as n from public.forecast_backtests where institution_id = ${inst.institutionId}::uuid`;
      const [afterForecasts] = await sql`select count(*)::int as n from public.forecasts where institution_id = ${inst.institutionId}::uuid`;
      expect(afterBacktests.n).toBe(beforeBacktests.n);
      expect(afterForecasts.n).toBe(beforeForecasts.n);
    } finally {
      await inst.cleanup();
    }
  });
});
