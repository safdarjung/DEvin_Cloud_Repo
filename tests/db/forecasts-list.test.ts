// M21-T10 — src/modules/forecasts/queries.ts (listForecasts) via the
// query-defs wrapper (callAs — real permission guard + real RLS). Rows
// inserted with the admin client (service-role writes only, per 0094
// rulings — no forecast.run job in this lane yet). Mirrors
// tests/db/forecasts-queries.test.ts (T9) fixture style.
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => import("../helpers/server-client-mock"));

import { forecastsListQuery } from "@/modules/forecasts/query-defs";
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

const HOLDOUT = [
  { start: "2026-01-01", label: "h1", actual: 10, predicted: 9 },
  { start: "2026-02-01", label: "h2", actual: 11, predicted: 10 },
  { start: "2026-03-01", label: "h3", actual: 12, predicted: 11 },
];

async function seedForecast(
  institutionId: string,
  kind: Kind,
  seriesKey: string,
  classSectionId: string | null,
  unit: Unit,
  opts: { point: number; lower: number; upper: number; confidence: number; horizon?: number; mape?: number; nTrain?: number },
): Promise<void> {
  const model = "moving_average_v1";
  const asOf = "2026-11-01";

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
      n_train: opts.nTrain ?? 4,
      holdout: HOLDOUT,
      mape: opts.mape ?? 0.1,
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
    period_start: "2026-12-01",
    period_label: "H1",
    point: opts.point,
    lower: opts.lower,
    upper: opts.upper,
    confidence: opts.confidence,
    evidence: { history: [], origin: { start: "2025-08-01", label: "o" }, params: { k: 2 } } as unknown as NonNullable<Json>,
    as_of: asOf,
  });
  if (fcError) throw fcError;
}

async function setupListFixture(name: string): Promise<{ inst: TestInstitution; taughtSection: string }> {
  const inst = await createTestInstitution(name);
  await enableForecasts(inst.institutionId);
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await teacherStaffId(inst.institutionId);
  const taughtSection = await createClassSection(inst.institutionId, gradeId, yearId, {
    name: "A",
    classTeacherId: teacherStaff,
  });

  // fees:term — school-wide, kind fee_collections_term (sorts last: "fee..." > "attendance...").
  await seedForecast(inst.institutionId, "fee_collections_term", "fees:term", null, "paise", {
    point: 500_000,
    lower: 450_000,
    upper: 550_000,
    confidence: 0.7,
  });
  // attendance:school — school-wide attendance, sorts before the section row.
  await seedForecast(inst.institutionId, "attendance_rate_week", "attendance:school", null, "pct", {
    point: 92.5,
    lower: 88,
    upper: 97,
    confidence: 0.85,
  });
  // attendance:section:<taughtSection> — the teacher's own section.
  await seedForecast(
    inst.institutionId,
    "attendance_rate_week",
    `attendance:section:${taughtSection}`,
    taughtSection,
    "pct",
    { point: 80, lower: 75, upper: 85, confidence: 0.6 },
  );

  return { inst, taughtSection };
}

describe("forecasts.list (src/modules/forecasts/query-defs.ts)", () => {
  it("principal: ordered kind, school-wide first, section label, horizon — mape/nTrain/holdout embedded", async () => {
    const { inst, taughtSection } = await setupListFixture("fc10-list-principal");
    try {
      const result = await callAs(inst, "principal", forecastsListQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((row) => [row.seriesKey, row.classSectionId, row.sectionLabel])).toEqual([
        ["attendance:school", null, null],
        [`attendance:section:${taughtSection}`, taughtSection, "VI-A"],
        ["fees:term", null, null],
      ]);
      for (const row of result.data) {
        expect(row.mape).toBe(0.1);
        expect(row.nTrain).toBe(4);
        expect(row.holdout).toEqual(HOLDOUT);
      }
      const sectionRow = result.data.find((row) => row.classSectionId === taughtSection)!;
      expect(sectionRow).toMatchObject({ unit: "pct", model: "moving_average_v1", horizon: 1, point: 80, lower: 75, upper: 85, confidence: 0.6 });
    } finally {
      await inst.cleanup();
    }
  });

  it("kind filter: fee_collections_term only", async () => {
    const { inst } = await setupListFixture("fc10-list-kind");
    try {
      const result = await callAs(inst, "principal", forecastsListQuery, { kind: "fee_collections_term" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((row) => row.seriesKey)).toEqual(["fees:term"]);
    } finally {
      await inst.cleanup();
    }
  });

  it("classSectionId filter: that section only", async () => {
    const { inst, taughtSection } = await setupListFixture("fc10-list-section");
    try {
      const result = await callAs(inst, "principal", forecastsListQuery, { classSectionId: taughtSection });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((row) => row.seriesKey)).toEqual([`attendance:section:${taughtSection}`]);
    } finally {
      await inst.cleanup();
    }
  });

  it("teacher: only their taught section (no school-wide, no fees) — RLS, not the query", async () => {
    const { inst, taughtSection } = await setupListFixture("fc10-list-teacher");
    try {
      const result = await callAs(inst, "teacher", forecastsListQuery, {});
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.map((row) => row.seriesKey)).toEqual([`attendance:section:${taughtSection}`]);
      expect(result.data[0].sectionLabel).toBe("VI-A");
    } finally {
      await inst.cleanup();
    }
  });

  it("guardian: forbidden (no forecast.read permission)", async () => {
    const { inst } = await setupListFixture("fc10-list-guardian");
    try {
      const result = await callAs(inst, "guardian", forecastsListQuery, {});
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("forbidden");
    } finally {
      await inst.cleanup();
    }
  });
});
