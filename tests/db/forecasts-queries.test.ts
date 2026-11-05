// M21-T9 — src/modules/forecasts/queries.ts (forecastCards, financeSeries)
// via the query-defs wrapper (callAs — real permission guard + real RLS),
// same pattern as tests/db/facilities-queries.test.ts. Rows inserted with
// the admin client (service-role writes only, per 0094 rulings — no
// forecast.run job in this lane yet).
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { forecastsCardsQuery, forecastsFinanceSeriesQuery } from "@/modules/forecasts/query-defs";
import type { Json } from "@/lib/db/types";
import { callAs, closeActionsHelper } from "../helpers/actions";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeActionsHelper();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function enableForecasts(institutionId: string): Promise<void> {
  await sql`
    update public.institutions
    set settings = jsonb_set(coalesce(settings, '{}'::jsonb), array['modules', 'forecasts'], 'true'::jsonb)
    where id = ${institutionId}::uuid
  `;
}

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

type Kind = "fee_collections_term" | "attendance_rate_week";
type Unit = "paise" | "pct";

interface HistoryItem {
  start: string;
  label: string;
  value: number;
  billed?: number;
}

interface SeedForecastOpts {
  point: number;
  lower: number;
  upper: number;
  confidence: number;
  horizon?: number;
  periodStart?: string;
  periodLabel?: string;
  history?: HistoryItem[];
}

async function seedForecast(
  institutionId: string,
  kind: Kind,
  seriesKey: string,
  classSectionId: string | null,
  unit: Unit,
  opts: SeedForecastOpts,
): Promise<void> {
  const model = "moving_average_v1";
  const asOf = "2026-11-01";
  const holdout = [
    { start: "2026-01-01", label: "h1", actual: 10, predicted: 9 },
    { start: "2026-02-01", label: "h2", actual: 11, predicted: 10 },
    { start: "2026-03-01", label: "h3", actual: 12, predicted: 11 },
  ];

  const { data: backtest, error: btError } = await admin
    .from("forecast_backtests")
    .insert({
      institution_id: institutionId,
      series_key: seriesKey,
      kind,
      class_section_id: classSectionId,
      unit,
      model,
      origin_start: "2025-08-01",
      n_train: 4,
      holdout,
      mape: 0.1,
      params: { k: 2 },
      as_of: asOf,
    })
    .select("id")
    .single();
  if (btError) throw btError;

  const { error: fcError } = await admin.from("forecasts").insert({
    institution_id: institutionId,
    series_key: seriesKey,
    kind,
    class_section_id: classSectionId,
    unit,
    model,
    backtest_id: backtest!.id,
    horizon: opts.horizon ?? 1,
    period_start: opts.periodStart ?? "2026-12-01",
    period_label: opts.periodLabel ?? "H1",
    point: opts.point,
    lower: opts.lower,
    upper: opts.upper,
    confidence: opts.confidence,
    evidence: { history: opts.history ?? [], origin: { start: "2025-08-01", label: "o" }, params: { k: 2 } } as unknown as NonNullable<Json>,
    as_of: asOf,
  });
  if (fcError) throw fcError;
}

async function setupCardsFixture(name: string): Promise<{ inst: TestInstitution }> {
  const inst = await createTestInstitution(name);
  await enableForecasts(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await teacherStaffId(inst.institutionId);
  const taughtSection = await createClassSection(inst.institutionId, gradeId, yearId, {
    name: "A",
    classTeacherId: teacherStaff,
  });

  // attendance:school — flat direction: forecast within 2% of current (92 -> 92.5).
  await seedForecast(inst.institutionId, "attendance_rate_week", "attendance:school", null, "pct", {
    point: 92.5,
    lower: 88,
    upper: 97,
    confidence: 0.85,
    history: [{ start: "2026-10-05", label: "2026-W41", value: 92 }],
  });
  // fees:term — up direction: current 0 (no history yet), forecast > 0.
  await seedForecast(inst.institutionId, "fee_collections_term", "fees:term", null, "paise", {
    point: 500_000,
    lower: 450_000,
    upper: 550_000,
    confidence: 0.7,
    history: [],
  });
  // teacher's own taught section — visible to the teacher via RLS, but
  // cards only ever looks at attendance:school/fees:term, never a section key.
  await seedForecast(
    inst.institutionId,
    "attendance_rate_week",
    `attendance:section:${taughtSection}`,
    taughtSection,
    "pct",
    { point: 80, lower: 75, upper: 85, confidence: 0.6, history: [{ start: "2026-10-05", label: "2026-W41", value: 79 }] },
  );

  return { inst };
}

describe("forecasts.cards (src/modules/forecasts/query-defs.ts)", () => {
  it("principal: Attendance Rate (flat) then Fee Collection (up from 0), confidence from the row", async () => {
    const { inst } = await setupCardsFixture("fc9-cards-principal");
    try {
      const result = await callAs(inst, "principal", forecastsCardsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([
        { metric: "Attendance Rate", current: 92, forecast: 92.5, unit: "pct", confidence: 0.85, direction: "flat" },
        { metric: "Fee Collection", current: 0, forecast: 500_000, unit: "paise", confidence: 0.7, direction: "up" },
      ]);
    } finally {
      await inst.cleanup();
    }
  });

  it("accountant: fee card only", async () => {
    const { inst } = await setupCardsFixture("fc9-cards-accountant");
    try {
      const result = await callAs(inst, "accountant", forecastsCardsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([
        { metric: "Fee Collection", current: 0, forecast: 500_000, unit: "paise", confidence: 0.7, direction: "up" },
      ]);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher: [] (no school-wide or fee rows, despite seeing their own section via RLS)", async () => {
    const { inst } = await setupCardsFixture("fc9-cards-teacher");
    try {
      const result = await callAs(inst, "teacher", forecastsCardsQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian: forbidden (no forecast.read permission)", async () => {
    const { inst } = await setupCardsFixture("fc9-cards-guardian");
    try {
      const result = await callAs(inst, "guardian", forecastsCardsQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});

describe("forecasts.financeSeries (src/modules/forecasts/query-defs.ts)", () => {
  it("history points (low=high=collected, expected=billed) then horizon points, month = term start month", async () => {
    const inst = await createTestInstitution("fc9-finance-series");
    await enableForecasts(inst.institutionId);
    try {
      await seedForecast(inst.institutionId, "fee_collections_term", "fees:term", null, "paise", {
        point: 250_000,
        lower: 200_000,
        upper: 300_000,
        confidence: 0.75,
        periodStart: "2026-12-01",
        history: [
          { start: "2026-04-01", label: "T1", value: 300_000, billed: 320_000 },
          { start: "2026-08-01", label: "T2", value: 280_000, billed: 290_000 },
        ],
      });

      const result = await callAs(inst, "principal", forecastsFinanceSeriesQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([
        { month: "2026-04", collected_paise: 300_000, expected_paise: 320_000, forecast_low_paise: 300_000, forecast_high_paise: 300_000 },
        { month: "2026-08", collected_paise: 280_000, expected_paise: 290_000, forecast_low_paise: 280_000, forecast_high_paise: 280_000 },
        { month: "2026-12", collected_paise: 0, expected_paise: 250_000, forecast_low_paise: 200_000, forecast_high_paise: 300_000 },
      ]);
    } finally {
      await inst.cleanup();
    }
  });

  it("no fee forecast -> []", async () => {
    const inst = await createTestInstitution("fc9-finance-nofee");
    await enableForecasts(inst.institutionId);
    try {
      await seedForecast(inst.institutionId, "attendance_rate_week", "attendance:school", null, "pct", {
        point: 90,
        lower: 85,
        upper: 95,
        confidence: 0.8,
        history: [{ start: "2026-10-05", label: "2026-W41", value: 89 }],
      });

      const result = await callAs(inst, "principal", forecastsFinanceSeriesQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toEqual([]);
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian: forbidden (no forecast.read permission)", async () => {
    const inst = await createTestInstitution("fc9-finance-guardian");
    await enableForecasts(inst.institutionId);
    try {
      const result = await callAs(inst, "guardian", forecastsFinanceSeriesQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
