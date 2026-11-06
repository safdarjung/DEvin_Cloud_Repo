// M21-T7 — job handler `forecast.run` (06-backend-packets/M21-tasks.md
// Task 7). Called directly against the real tables/RPCs with a fake
// JobRow, same pattern as tests/db/invoice-generation.test.ts's
// `fakeJob` + direct handler call (no runner needed here — the runner's
// own claim/dispatch wiring is tests/db/jobs.test.ts's job, unchanged).
import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { forecastRun } from "@/modules/jobs/handlers/forecast.run";
import type { JobRow } from "@/modules/jobs/types";
import { closeFactoriesHelper, createAcademicYear, createTerm } from "../helpers/factories";
import { closeForecastFixturesHelper, seedForecastHistory } from "../helpers/forecast-fixtures";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

process.env.SERVICE_ROLE_CALLER = "test";
const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();

const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 10 });

afterAll(async () => {
  await sql.end();
  await closeForecastFixturesHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

const createdInstitutions: TestInstitution[] = [];
afterEach(async () => {
  await Promise.all(createdInstitutions.splice(0).map((inst) => inst.cleanup()));
});

function fakeJob(institutionId: string | null, payload: Record<string, unknown>): JobRow {
  return {
    id: crypto.randomUUID(),
    institution_id: institutionId,
    type: "forecast.run",
    payload,
    idempotency_key: crypto.randomUUID(),
    status: "running",
    attempts: 1,
    max_attempts: 5,
    run_after: new Date().toISOString(),
    locked_at: null,
    locked_by: null,
    last_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function plusOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe("forecast.run job handler (M21-T7)", () => {
  it("builds seasonal fee forecasts and moving-average attendance forecasts from seeded history; backtest ids match; no student reference in either table", async () => {
    const inst = await createTestInstitution("forecast-run");
    createdInstitutions.push(inst);
    const { asOf, feeHorizons } = await seedForecastHistory(inst);

    await forecastRun(fakeJob(inst.institutionId, { as_of: asOf }), { admin });

    const { data: backtests, error: btError } = await admin
      .from("forecast_backtests")
      .select("*")
      .eq("institution_id", inst.institutionId);
    if (btError) throw btError;
    const { data: forecasts, error: fError } = await admin
      .from("forecasts")
      .select("*")
      .eq("institution_id", inst.institutionId);
    if (fError) throw fError;

    const feeForecasts = forecasts!.filter((f) => f.series_key === "fees:term");
    expect(feeForecasts).toHaveLength(feeHorizons);
    expect(feeForecasts.every((f) => f.model === "seasonal_naive_v1")).toBe(true);

    const schoolForecasts = forecasts!.filter((f) => f.series_key === "attendance:school");
    expect(schoolForecasts).toHaveLength(3);
    expect(schoolForecasts.every((f) => f.model === "moving_average_v1")).toBe(true);

    const sectionForecasts = forecasts!.filter((f) => f.series_key.startsWith("attendance:section:"));
    expect(sectionForecasts).toHaveLength(3);
    expect(sectionForecasts.every((f) => f.model === "moving_average_v1")).toBe(true);

    // Every forecast row's backtest_id names a backtest of the same series and model.
    for (const f of forecasts!) {
      const bt = backtests!.find((b) => b.id === f.backtest_id);
      expect(bt).toBeDefined();
      expect(bt!.series_key).toBe(f.series_key);
      expect(bt!.model).toBe(f.model);
    }

    const cols = await sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and table_name in ('forecasts', 'forecast_backtests') and column_name = 'student_id'
    `;
    expect(cols).toHaveLength(0);
  });

  it("rerun with the same as_of writes identical rows, no duplicates", async () => {
    const inst = await createTestInstitution("forecast-run-rerun");
    createdInstitutions.push(inst);
    const { asOf } = await seedForecastHistory(inst);

    await forecastRun(fakeJob(inst.institutionId, { as_of: asOf }), { admin });
    const { data: before } = await admin
      .from("forecasts")
      .select("id, series_key, horizon, point, lower, upper")
      .eq("institution_id", inst.institutionId)
      .order("series_key")
      .order("horizon");

    await forecastRun(fakeJob(inst.institutionId, { as_of: asOf }), { admin });
    const { data: after } = await admin
      .from("forecasts")
      .select("id, series_key, horizon, point, lower, upper")
      .eq("institution_id", inst.institutionId)
      .order("series_key")
      .order("horizon");

    expect(after).toEqual(before);
  });

  it("a later as_of deletes the previous run's rows", async () => {
    const inst = await createTestInstitution("forecast-run-next-day");
    createdInstitutions.push(inst);
    const { asOf } = await seedForecastHistory(inst);
    const nextAsOf = plusOneDay(asOf);

    await forecastRun(fakeJob(inst.institutionId, { as_of: asOf }), { admin });
    await forecastRun(fakeJob(inst.institutionId, { as_of: nextAsOf }), { admin });

    const { data: forecasts } = await admin.from("forecasts").select("as_of").eq("institution_id", inst.institutionId);
    const { data: backtests } = await admin
      .from("forecast_backtests")
      .select("as_of")
      .eq("institution_id", inst.institutionId);

    expect(forecasts!.length).toBeGreaterThan(0);
    expect(forecasts!.every((f) => f.as_of === nextAsOf)).toBe(true);
    expect(backtests!.every((b) => b.as_of === nextAsOf)).toBe(true);
  });

  it("an older as_of replay writes nothing", async () => {
    const inst = await createTestInstitution("forecast-run-replay");
    createdInstitutions.push(inst);
    const { asOf } = await seedForecastHistory(inst);
    const nextAsOf = plusOneDay(asOf);

    await forecastRun(fakeJob(inst.institutionId, { as_of: nextAsOf }), { admin });
    const { data: before } = await admin
      .from("forecasts")
      .select("id, as_of")
      .eq("institution_id", inst.institutionId)
      .order("id");

    await forecastRun(fakeJob(inst.institutionId, { as_of: asOf }), { admin }); // older replay

    const { data: after } = await admin
      .from("forecasts")
      .select("id, as_of")
      .eq("institution_id", inst.institutionId)
      .order("id");
    expect(after).toEqual(before);
  });

  it("fewer than 4 complete terms -> no fee backtest or forecast", async () => {
    const inst = await createTestInstitution("forecast-run-few-terms");
    createdInstitutions.push(inst);
    const year = await createAcademicYear(inst.institutionId, { name: "2020-21", startsOn: "2020-04-01", endsOn: "2021-03-31" });
    await createTerm(inst.institutionId, year, { name: "T1", sequence: 1, startsOn: "2020-04-01", endsOn: "2020-07-31" });
    await createTerm(inst.institutionId, year, { name: "T2", sequence: 2, startsOn: "2020-08-01", endsOn: "2020-11-30" });

    await forecastRun(fakeJob(inst.institutionId, { as_of: "2020-08-15" }), { admin });

    const { data: backtests } = await admin
      .from("forecast_backtests")
      .select("*")
      .eq("institution_id", inst.institutionId);
    const { data: forecasts } = await admin.from("forecasts").select("*").eq("institution_id", inst.institutionId);
    expect(backtests).toHaveLength(0);
    expect(forecasts).toHaveLength(0);
  });

  it("missing institution_id throws", async () => {
    const job = fakeJob(null, { as_of: "2026-01-01" });
    await expect(forecastRun(job, { admin })).rejects.toThrow(/institution_id/);
  });

  it("invalid payload throws without echoing it", async () => {
    const inst = await createTestInstitution("forecast-run-bad-payload");
    createdInstitutions.push(inst);
    const job = fakeJob(inst.institutionId, { as_of: "not-a-date" });
    await expect(forecastRun(job, { admin })).rejects.toThrow("forecast.run: invalid payload");
  });
});
