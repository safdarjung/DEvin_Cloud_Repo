// M21-T7 — job handler `forecast.run` (M21-tasks.md rulings "Latest run
// only", "Scheduling"). Payload `{ as_of }` built by `public.enqueue_due_forecasts`
// (T3) — never trust it beyond that, everything else is re-read per
// institution. No LLM here (rulings "No LLM in M21") — pure deterministic
// TS (T5 engine, T6 series builders) fed by two service-role-only SQL
// sources (T3). Relative `.ts` imports for the forecasts module (runner-
// loaded files rule, BRIEF-COMMON); type-only `@/` imports are erased at
// build time so they don't hit that rule.
//
// Idempotent: upserts on (institution_id, series_key, model) and
// (institution_id, series_key, horizon) — a retry/reclaim or a same-`as_of`
// replay from a concurrent sweep writes identical rows, never duplicates.
import type { Json } from "@/lib/db/types";
import { ForecastRunPayloadSchema } from "../../forecasts/schemas.ts";
import { runSeries } from "../../forecasts/engine.ts";
import {
  attendanceWindow,
  buildAttendanceSeries,
  buildFeeSeries,
  historyEvidence,
  type AttendanceSeriesRow,
  type FeeSeriesRow,
  type SeriesSpec,
} from "../../forecasts/series.ts";
import type { JobHandler } from "../types.ts";

export const forecastRun: JobHandler = async (job, { admin }) => {
  if (!job.institution_id) {
    throw new Error("forecast.run: job has no institution_id");
  }

  const parsed = ForecastRunPayloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    // No PII/payload echo — never log or throw the raw payload.
    throw new Error("forecast.run: invalid payload");
  }
  const asOf = parsed.data.as_of;
  const institutionId = job.institution_id;

  // Late replay: a sweep/retry whose as_of is older than what's already
  // on record writes nothing (rulings "Latest run only").
  const { data: latest, error: latestError } = await admin
    .from("forecasts")
    .select("as_of")
    .eq("institution_id", institutionId)
    .order("as_of", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) throw latestError;
  if (latest && latest.as_of > asOf) return;

  const { data: feeRowsRaw, error: feeError } = await admin.rpc("forecast_fee_series", {
    p_institution_id: institutionId,
  });
  if (feeError) throw feeError;
  const feeRows = (feeRowsRaw ?? []) as unknown as FeeSeriesRow[];

  const { from, to } = attendanceWindow(asOf);
  const { data: attendanceRowsRaw, error: attendanceError } = await admin.rpc("forecast_attendance_series", {
    p_institution_id: institutionId,
    p_from: from,
    p_to: to,
  });
  if (attendanceError) throw attendanceError;
  const attendanceRows = (attendanceRowsRaw ?? []) as unknown as AttendanceSeriesRow[];

  const specs: SeriesSpec[] = [];
  const feeSpec = buildFeeSeries(feeRows, asOf);
  if (feeSpec) specs.push(feeSpec);
  specs.push(...buildAttendanceSeries(attendanceRows, asOf));

  interface BacktestRow {
    institution_id: string;
    series_key: string;
    kind: string;
    class_section_id: string | null;
    unit: string;
    model: string;
    origin_start: string;
    n_train: number;
    holdout: NonNullable<Json>;
    mape: number;
    params: NonNullable<Json>;
    as_of: string;
  }

  interface PendingForecast {
    seriesKey: string;
    kind: string;
    classSectionId: string | null;
    unit: string;
    model: string;
    horizon: number;
    periodStart: string;
    periodLabel: string;
    point: number;
    lower: number;
    upper: number;
    confidence: number;
    evidence: NonNullable<Json>;
  }

  const backtestRows: BacktestRow[] = [];
  const pendingForecasts: PendingForecast[] = [];

  for (const spec of specs) {
    const result = runSeries(spec.periods, spec.targets, { k: spec.k, unit: spec.unit });

    for (const bt of result.backtests) {
      backtestRows.push({
        institution_id: institutionId,
        series_key: spec.seriesKey,
        kind: spec.kind,
        class_section_id: spec.classSectionId,
        unit: spec.unit,
        model: bt.model,
        origin_start: bt.originStart,
        n_train: bt.nTrain,
        holdout: bt.holdout as unknown as NonNullable<Json>,
        mape: bt.mape,
        params: bt.params as NonNullable<Json>,
        as_of: asOf,
      });
    }

    if (result.selected && result.forecast.length > 0) {
      const selectedBt = result.backtests.find((b) => b.model === result.selected)!;
      const originPeriod = spec.periods.find((p) => p.start === selectedBt.originStart);
      const evidence = {
        history: historyEvidence(spec),
        origin: { start: selectedBt.originStart, label: originPeriod?.label ?? selectedBt.originStart },
        params: selectedBt.params,
      } as unknown as NonNullable<Json>;

      for (const fp of result.forecast) {
        pendingForecasts.push({
          seriesKey: spec.seriesKey,
          kind: spec.kind,
          classSectionId: spec.classSectionId,
          unit: spec.unit,
          model: result.selected,
          horizon: fp.horizon,
          periodStart: fp.start,
          periodLabel: fp.label,
          point: fp.point,
          lower: fp.lower,
          upper: fp.upper,
          confidence: result.confidence!,
          evidence,
        });
      }
    }
  }

  const backtestIdMap = new Map<string, string>();
  if (backtestRows.length > 0) {
    const { data: upserted, error: backtestUpsertError } = await admin
      .from("forecast_backtests")
      .upsert(backtestRows, { onConflict: "institution_id,series_key,model" })
      .select("id, series_key, model");
    if (backtestUpsertError) throw backtestUpsertError;
    for (const row of upserted ?? []) {
      backtestIdMap.set(`${row.series_key}::${row.model}`, row.id);
    }
  }

  const forecastRows = pendingForecasts.map((pf) => ({
    institution_id: institutionId,
    series_key: pf.seriesKey,
    kind: pf.kind,
    class_section_id: pf.classSectionId,
    unit: pf.unit,
    model: pf.model,
    backtest_id: backtestIdMap.get(`${pf.seriesKey}::${pf.model}`)!,
    horizon: pf.horizon,
    period_start: pf.periodStart,
    period_label: pf.periodLabel,
    point: pf.point,
    lower: pf.lower,
    upper: pf.upper,
    confidence: pf.confidence,
    evidence: pf.evidence,
    as_of: asOf,
  }));

  if (forecastRows.length > 0) {
    const { error: forecastUpsertError } = await admin
      .from("forecasts")
      .upsert(forecastRows, { onConflict: "institution_id,series_key,horizon" });
    if (forecastUpsertError) throw forecastUpsertError;
  }

  // Replace semantics: drop anything older than this run (forecasts first,
  // per rulings, though the FK's own cascade would also clean up).
  const { error: deleteForecastsError } = await admin
    .from("forecasts")
    .delete()
    .eq("institution_id", institutionId)
    .lt("as_of", asOf);
  if (deleteForecastsError) throw deleteForecastsError;

  const { error: deleteBacktestsError } = await admin
    .from("forecast_backtests")
    .delete()
    .eq("institution_id", institutionId)
    .lt("as_of", asOf);
  if (deleteBacktestsError) throw deleteBacktestsError;

  // System job — no audit row. Never log job.payload (may hold PII); ids
  // and counts only.
  console.info("forecast.run: completed", {
    jobId: job.id,
    backtests: backtestRows.length,
    forecasts: forecastRows.length,
  });
};
