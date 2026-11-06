// M21-T5 — pure forecast engine (deterministic, no LLM). Relative .ts import.
import type { ForecastModel, ForecastUnit } from "./schemas.ts";
import { FORECAST_MODELS } from "./schemas.ts";

export interface Period {
  start: string;
  label: string;
  value: number;
  seasonKey: string;
}

export interface Target {
  start: string;
  label: string;
  seasonKey: string;
}

export interface Backtest {
  model: ForecastModel;
  originStart: string;
  nTrain: number;
  holdout: { start: string; label: string; actual: number; predicted: number }[];
  mape: number;
  params: Record<string, unknown>;
}

export interface ForecastPoint {
  horizon: number;
  start: string;
  label: string;
  point: number;
  lower: number;
  upper: number;
}

export interface SeriesResult {
  backtests: Backtest[];
  selected: ForecastModel | null;
  confidence: number | null;
  forecast: ForecastPoint[];
}

export const HOLDOUT = 3;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function predict(
  model: ForecastModel,
  train: Period[],
  target: Target,
  k: number,
): number | null {
  if (model === "moving_average_v1") {
    if (train.length < k) return null;
    const last = train.slice(-k);
    return last.reduce((sum, p) => sum + p.value, 0) / k;
  }
  // seasonal_naive_v1: latest training period with the same seasonKey, scanning from the end.
  for (let i = train.length - 1; i >= 0; i--) {
    if (train[i].seasonKey === target.seasonKey) return train[i].value;
  }
  return null;
}

export function mape(pairs: { actual: number; predicted: number }[]): number | null {
  const nonZero = pairs.filter((p) => p.actual !== 0);
  if (nonZero.length === 0) return null;
  const mean =
    nonZero.reduce((sum, p) => sum + Math.abs(p.actual - p.predicted) / Math.abs(p.actual), 0) /
    nonZero.length;
  return round4(mean);
}

function backtestModel(model: ForecastModel, periods: Period[], k: number): Backtest | null {
  if (periods.length < HOLDOUT + 1) return null;
  const train = periods.slice(0, periods.length - HOLDOUT);
  const holdoutPeriods = periods.slice(periods.length - HOLDOUT);
  const predictions = holdoutPeriods.map((p) =>
    predict(model, train, { start: p.start, label: p.label, seasonKey: p.seasonKey }, k),
  );
  if (predictions.some((p) => p === null)) return null;
  const m = mape(holdoutPeriods.map((p, i) => ({ actual: p.value, predicted: predictions[i]! })));
  if (m === null) return null;
  return {
    model,
    originStart: train[train.length - 1].start,
    nTrain: train.length,
    holdout: holdoutPeriods.map((p, i) => ({
      start: p.start,
      label: p.label,
      actual: p.value,
      predicted: predictions[i]!,
    })),
    mape: m,
    params: model === "moving_average_v1" ? { k } : { match: "seasonKey" },
  };
}

export function runSeries(
  periods: Period[],
  targets: Target[],
  opts: { k: number; unit: ForecastUnit },
): SeriesResult {
  const { k, unit } = opts;
  const backtests = FORECAST_MODELS.map((model) => backtestModel(model, periods, k)).filter(
    (b): b is Backtest => b !== null,
  );

  if (targets.length === 0) {
    return { backtests, selected: null, confidence: null, forecast: [] };
  }

  let selected: ForecastModel | null = null;
  let bestMape = Infinity;
  for (const model of FORECAST_MODELS) {
    const bt = backtests.find((b) => b.model === model);
    if (!bt) continue;
    const predictsEveryTarget = targets.every((t) => predict(model, periods, t, k) !== null);
    if (!predictsEveryTarget) continue;
    if (bt.mape < bestMape) {
      bestMape = bt.mape;
      selected = model;
    }
  }

  if (!selected) {
    return { backtests, selected: null, confidence: null, forecast: [] };
  }

  const selectedBt = backtests.find((b) => b.model === selected)!;
  const confidence = round3(clamp(1 - selectedBt.mape, 0, 1));
  const forecast: ForecastPoint[] = targets.map((target, idx) => {
    const horizon = idx + 1;
    const rawPoint = predict(selected!, periods, target, k)!;
    const hw = rawPoint * selectedBt.mape * Math.sqrt(horizon);
    let point = rawPoint;
    const lower = Math.max(0, rawPoint - hw);
    let upper = rawPoint + hw;
    if (unit === "pct") {
      point = Math.min(point, 100);
      upper = Math.min(upper, 100);
    }
    const round = unit === "paise" ? Math.round : round2;
    return {
      horizon,
      start: target.start,
      label: target.label,
      point: round(point),
      lower: round(lower),
      upper: round(upper),
    };
  });

  return { backtests, selected, confidence, forecast };
}
