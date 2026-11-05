import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { closeFactoriesHelper, createAcademicYear, createClassSection, createGrade } from "../helpers/factories";
import { closeRolesHelper, createTestInstitution, type TestInstitution } from "../helpers/roles";

const { createAdminClient } = await import("@/lib/supabase/admin");
const admin = createAdminClient();
const sql = postgres(process.env.SUPABASE_DB_URL as string, { max: 5 });

afterAll(async () => {
  await sql.end();
  await closeFactoriesHelper();
  await closeRolesHelper();
});

async function teacherStaffId(institutionId: string): Promise<string> {
  const [row] = await sql`select staff_id from public.memberships where institution_id = ${institutionId} and role = 'teacher'`;
  return row.staff_id as string;
}

const HOLDOUT = [
  { start: "2026-01-01", label: "h1", actual: 10, predicted: 9 },
  { start: "2026-02-01", label: "h2", actual: 11, predicted: 10 },
  { start: "2026-03-01", label: "h3", actual: 12, predicted: 11 },
];

type Kind = "fee_collections_term" | "attendance_rate_week";
type Unit = "paise" | "pct";
type Model = "moving_average_v1" | "seasonal_naive_v1";

interface SeedOpts {
  model?: Model;
  asOf?: string;
  point?: number;
  lower?: number;
  upper?: number;
}

async function seedSeries(
  institutionId: string,
  kind: Kind,
  seriesKey: string,
  classSectionId: string | null,
  unit: Unit,
  opts: SeedOpts = {},
): Promise<{ backtestId: string; forecastId: string }> {
  const model = opts.model ?? "moving_average_v1";
  const asOf = opts.asOf ?? "2026-11-01";

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
      holdout: HOLDOUT,
      mape: 0.1,
      params: { k: 2 },
      as_of: asOf,
    })
    .select("id")
    .single();
  if (btError) throw btError;

  const point = opts.point ?? (unit === "pct" ? 90 : 100_000);
  const lower = opts.lower ?? (unit === "pct" ? 85 : 90_000);
  const upper = opts.upper ?? (unit === "pct" ? 95 : 110_000);

  const { data: forecast, error: fcError } = await admin
    .from("forecasts")
    .insert({
      institution_id: institutionId,
      series_key: seriesKey,
      kind,
      class_section_id: classSectionId,
      unit,
      model,
      backtest_id: backtest!.id,
      horizon: 1,
      period_start: "2026-12-01",
      period_label: "H1",
      point,
      lower,
      upper,
      confidence: 0.8,
      evidence: { history: [], origin: { start: "2025-08-01", label: "o" }, params: { k: 2 } },
      as_of: asOf,
    })
    .select("id")
    .single();
  if (fcError) throw fcError;

  return { backtestId: backtest!.id as string, forecastId: forecast!.id as string };
}

interface Seeded {
  inst: TestInstitution;
  sectionTaught: string;
  sectionOther: string | null;
  series: Record<string, { backtestId: string; forecastId: string; seriesKey: string }>;
}

async function setup(name: string, withOtherSection: boolean): Promise<Seeded> {
  const inst = await createTestInstitution(name);
  const yearId = await createAcademicYear(inst.institutionId);
  const gradeId = await createGrade(inst.institutionId);
  const teacherStaff = await teacherStaffId(inst.institutionId);
  const sectionTaught = await createClassSection(inst.institutionId, gradeId, yearId, {
    name: "A",
    classTeacherId: teacherStaff,
  });
  const sectionOther = withOtherSection
    ? await createClassSection(inst.institutionId, gradeId, yearId, { name: "B" })
    : null;

  const series: Seeded["series"] = {};

  const fees = await seedSeries(inst.institutionId, "fee_collections_term", "fees:term", null, "paise");
  series.fees = { ...fees, seriesKey: "fees:term" };

  const school = await seedSeries(inst.institutionId, "attendance_rate_week", "attendance:school", null, "pct");
  series.school = { ...school, seriesKey: "attendance:school" };

  const taughtKey = `attendance:section:${sectionTaught}`;
  const taught = await seedSeries(inst.institutionId, "attendance_rate_week", taughtKey, sectionTaught, "pct");
  series.taught = { ...taught, seriesKey: taughtKey };

  if (sectionOther) {
    const otherKey = `attendance:section:${sectionOther}`;
    const other = await seedSeries(inst.institutionId, "attendance_rate_week", otherKey, sectionOther, "pct");
    series.other = { ...other, seriesKey: otherKey };
  }

  return { inst, sectionTaught, sectionOther, series };
}

describe("migration 0094: forecast_backtests + forecasts RLS", () => {
  it("principal reads every row of their institution, none of another", async () => {
    const a = await setup("fc-a-principal", true);
    const b = await setup("fc-b-principal", false);
    try {
      const own = await a.inst.clientAs("principal").from("forecasts").select("id").eq("institution_id", a.inst.institutionId);
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(4);

      const ownBt = await a.inst
        .clientAs("principal")
        .from("forecast_backtests")
        .select("id")
        .eq("institution_id", a.inst.institutionId);
      expect(ownBt.data).toHaveLength(4);

      const cross = await a.inst.clientAs("principal").from("forecasts").select("id").eq("institution_id", b.inst.institutionId);
      expect(cross.error).toBeNull();
      expect(cross.data).toHaveLength(0);
    } finally {
      await a.inst.cleanup();
      await b.inst.cleanup();
    }
  });

  it("accountant reads fees:term only", async () => {
    const a = await setup("fc-a-accountant", true);
    try {
      const rows = await a.inst
        .clientAs("accountant")
        .from("forecasts")
        .select("series_key")
        .eq("institution_id", a.inst.institutionId);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(1);
      expect(rows.data![0].series_key).toBe("fees:term");
    } finally {
      await a.inst.cleanup();
    }
  });

  it("teacher reads only their taught section — not another section, not school, not fees", async () => {
    const a = await setup("fc-a-teacher", true);
    try {
      const rows = await a.inst
        .clientAs("teacher")
        .from("forecasts")
        .select("series_key")
        .eq("institution_id", a.inst.institutionId);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(1);
      expect(rows.data![0].series_key).toBe(a.series.taught.seriesKey);
    } finally {
      await a.inst.cleanup();
    }
  });

  it("exam_controller reads attendance rows (school + every section), not fees", async () => {
    const a = await setup("fc-a-examctrl", true);
    try {
      const rows = await a.inst
        .clientAs("exam_controller")
        .from("forecasts")
        .select("series_key, kind")
        .eq("institution_id", a.inst.institutionId);
      expect(rows.error).toBeNull();
      expect(rows.data).toHaveLength(3);
      expect(rows.data!.every((r) => r.kind === "attendance_rate_week")).toBe(true);
    } finally {
      await a.inst.cleanup();
    }
  });

  it("guardian and student read nothing", async () => {
    const a = await setup("fc-a-guardian-student", true);
    try {
      const guardian = await a.inst
        .clientAs("guardian")
        .from("forecasts")
        .select("id")
        .eq("institution_id", a.inst.institutionId);
      expect(guardian.error).toBeNull();
      expect(guardian.data).toHaveLength(0);

      const student = await a.inst
        .clientAs("student")
        .from("forecasts")
        .select("id")
        .eq("institution_id", a.inst.institutionId);
      expect(student.error).toBeNull();
      expect(student.data).toHaveLength(0);
    } finally {
      await a.inst.cleanup();
    }
  });

  it("authenticated insert/update/delete is rejected or affects 0 rows", async () => {
    const a = await setup("fc-a-write", true);
    try {
      const client = a.inst.clientAs("principal");

      const insert = await client.from("forecasts").insert({
        institution_id: a.inst.institutionId,
        series_key: "fees:term",
        kind: "fee_collections_term",
        class_section_id: null,
        unit: "paise",
        model: "moving_average_v1",
        backtest_id: a.series.fees.backtestId,
        horizon: 2,
        period_start: "2027-01-01",
        period_label: "intrusion",
        point: 1,
        lower: 0,
        upper: 1,
        confidence: 0.5,
        evidence: { history: [] },
        as_of: "2026-11-01",
      });
      expect(insert.error).not.toBeNull();

      const update = await client
        .from("forecasts")
        .update({ point: 999_999 })
        .eq("id", a.series.fees.forecastId)
        .select("id");
      expect(update.error !== null || (update.data ?? []).length === 0).toBe(true);

      const del = await client.from("forecasts").delete().eq("id", a.series.fees.forecastId).select("id");
      expect(del.error !== null || (del.data ?? []).length === 0).toBe(true);

      const stillThere = await sql`select point from public.forecasts where id = ${a.series.fees.forecastId}`;
      expect(stillThere).toHaveLength(1);
      expect(Number(stillThere[0].point)).not.toBe(999_999);
    } finally {
      await a.inst.cleanup();
    }
  });

  it("attendance kind with series_key = 'fees:term' is rejected by the shape check", async () => {
    const a = await setup("fc-a-shape", false);
    try {
      const { error } = await admin.from("forecast_backtests").insert({
        institution_id: a.inst.institutionId,
        series_key: "fees:term",
        kind: "attendance_rate_week",
        class_section_id: null,
        unit: "pct",
        model: "moving_average_v1",
        origin_start: "2025-08-01",
        n_train: 4,
        holdout: HOLDOUT,
        mape: 0.1,
        params: { k: 2 },
        as_of: "2026-11-01",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23514");
    } finally {
      await a.inst.cleanup();
    }
  });

  it("a forecast pointing at another series/model's backtest is rejected by the composite FK", async () => {
    const a = await setup("fc-a-fk", false);
    try {
      const { data: otherModelBt, error: btError } = await admin
        .from("forecast_backtests")
        .insert({
          institution_id: a.inst.institutionId,
          series_key: "fees:term",
          kind: "fee_collections_term",
          class_section_id: null,
          unit: "paise",
          model: "seasonal_naive_v1",
          origin_start: "2025-08-01",
          n_train: 4,
          holdout: HOLDOUT,
          mape: 0.2,
          params: { match: "seasonKey" },
          as_of: "2026-11-01",
        })
        .select("id")
        .single();
      expect(btError).toBeNull();

      // fees.backtestId is model 'moving_average_v1'; claiming model
      // 'seasonal_naive_v1' with that backtest_id has no matching row in
      // forecast_backtests (id, institution_id, series_key, model).
      const { error } = await admin.from("forecasts").insert({
        institution_id: a.inst.institutionId,
        series_key: "fees:term",
        kind: "fee_collections_term",
        class_section_id: null,
        unit: "paise",
        model: "seasonal_naive_v1",
        backtest_id: a.series.fees.backtestId,
        horizon: 2,
        period_start: "2027-01-01",
        period_label: "mismatch",
        point: 1,
        lower: 0,
        upper: 1,
        confidence: 0.5,
        evidence: { history: [] },
        as_of: "2026-11-01",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23503");
      void otherModelBt;
    } finally {
      await a.inst.cleanup();
    }
  });

  it("upper > 100 on a pct row is rejected", async () => {
    const a = await setup("fc-a-pct-cap", false);
    try {
      const { error } = await admin.from("forecasts").insert({
        institution_id: a.inst.institutionId,
        series_key: "attendance:school",
        kind: "attendance_rate_week",
        class_section_id: null,
        unit: "pct",
        model: "moving_average_v1",
        backtest_id: a.series.school.backtestId,
        horizon: 2,
        period_start: "2027-01-01",
        period_label: "over-cap",
        point: 99,
        lower: 90,
        upper: 101,
        confidence: 0.5,
        evidence: { history: [] },
        as_of: "2026-11-01",
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("23514");
    } finally {
      await a.inst.cleanup();
    }
  });

  it("deleting a backtest cascades to its forecasts", async () => {
    const a = await setup("fc-a-cascade", false);
    try {
      const { error } = await admin.from("forecast_backtests").delete().eq("id", a.series.school.backtestId);
      expect(error).toBeNull();

      const remaining = await sql`select id from public.forecasts where id = ${a.series.school.forecastId}`;
      expect(remaining).toHaveLength(0);
    } finally {
      await a.inst.cleanup();
    }
  });
});
