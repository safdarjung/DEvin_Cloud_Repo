import "server-only";
// M21-T9 — forecasts.cards / forecasts.financeSeries reads: replaces the
// fabric fixtures ForecastCard (forecastCards) and FinanceForecastPoint
// (financeForecast), src/modules/fabric/types.ts. RLS (0094) is the only
// row filter — rows this client can't see simply aren't returned.
import { createClient } from "@/lib/supabase/server";
import type { TenantContext } from "@/lib/auth/types";
import type { ForecastCard, FinanceForecastPoint } from "@/modules/fabric/types";
import type { ForecastListInput } from "./schemas";

interface HistoryItem {
  start: string;
  label: string;
  value: number;
  billed?: number;
}

interface CardRow {
  series_key: string;
  unit: "paise" | "pct";
  point: number;
  confidence: number;
  evidence: { history?: HistoryItem[] };
}

interface FinanceRow {
  period_start: string;
  point: number;
  lower: number;
  upper: number;
  evidence: { history?: HistoryItem[] };
}

const CARD_METRIC: Record<string, string> = {
  "attendance:school": "Attendance Rate",
  "fees:term": "Fee Collection",
};
// cards checks exactly these two keys, in this order (rulings: "horizon-1
// rows of attendance:school then fees:term" — no admissions card).
const CARD_SERIES_KEYS = ["attendance:school", "fees:term"] as const;
const FLAT_BAND = 0.02;

function cardDirection(current: number, forecast: number): "up" | "flat" | "down" {
  if (current === 0) return forecast > 0 ? "up" : "flat";
  if (Math.abs(forecast - current) / current <= FLAT_BAND) return "flat";
  return forecast > current ? "up" : "down";
}

export async function forecastCards(ctx: TenantContext): Promise<ForecastCard[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forecasts")
    .select("series_key, unit, point, confidence, evidence")
    .eq("institution_id", ctx.institution.id)
    .eq("horizon", 1)
    .in("series_key", CARD_SERIES_KEYS);
  if (error) throw error;
  const rows = (data ?? []) as CardRow[];
  const bySeriesKey = new Map(rows.map((row) => [row.series_key, row]));

  const cards: ForecastCard[] = [];
  for (const seriesKey of CARD_SERIES_KEYS) {
    const row = bySeriesKey.get(seriesKey);
    if (!row) continue;
    const history = row.evidence.history ?? [];
    const current = history.length > 0 ? history[history.length - 1].value : 0;
    const forecast = Number(row.point);
    cards.push({
      metric: CARD_METRIC[seriesKey],
      current,
      forecast,
      unit: row.unit,
      confidence: Number(row.confidence),
      direction: cardDirection(current, forecast),
    });
  }
  return cards;
}

export async function financeSeries(ctx: TenantContext): Promise<FinanceForecastPoint[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("forecasts")
    .select("period_start, point, lower, upper, evidence")
    .eq("institution_id", ctx.institution.id)
    .eq("series_key", "fees:term")
    .order("horizon", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as FinanceRow[];
  if (rows.length === 0) return [];

  const history = rows[0].evidence.history ?? [];
  const points: FinanceForecastPoint[] = history.map((item) => ({
    month: item.start.slice(0, 7),
    collected_paise: item.value,
    expected_paise: item.billed ?? 0,
    forecast_low_paise: item.value,
    forecast_high_paise: item.value,
  }));
  for (const row of rows) {
    points.push({
      month: row.period_start.slice(0, 7),
      collected_paise: 0,
      expected_paise: Number(row.point),
      forecast_low_paise: Number(row.lower),
      forecast_high_paise: Number(row.upper),
    });
  }
  return points;
}

// M21-T10 — forecasts.list: the full backtested surface (every series x
// horizon this client's RLS allows), MAPE included (rulings: "this is
// where the backtested MAPE is shown").
interface HoldoutItem {
  start: string;
  label: string;
  actual: number;
  predicted: number;
}

export interface ForecastRow {
  seriesKey: string;
  kind: string;
  classSectionId: string | null;
  sectionLabel: string | null;
  unit: string;
  model: string;
  horizon: number;
  periodStart: string;
  periodLabel: string;
  point: number;
  lower: number;
  upper: number;
  confidence: number;
  mape: number;
  nTrain: number;
  holdout: HoldoutItem[];
  asOf: string;
}

interface ListRow {
  series_key: string;
  kind: string;
  class_section_id: string | null;
  unit: string;
  model: string;
  horizon: number;
  period_start: string;
  period_label: string;
  point: number;
  lower: number;
  upper: number;
  confidence: number;
  as_of: string;
  forecast_backtests: { mape: number; n_train: number; holdout: HoldoutItem[] } | null;
  class_sections: { name: string; grades: { code: string } | null } | null;
}

/** kind, school-wide first, section label, horizon (rulings "Queries — forecasts.list"). */
function byListOrder(a: ForecastRow, b: ForecastRow): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const aSchoolWide = a.classSectionId === null;
  const bSchoolWide = b.classSectionId === null;
  if (aSchoolWide !== bSchoolWide) return aSchoolWide ? -1 : 1;
  const labelCmp = (a.sectionLabel ?? "").localeCompare(b.sectionLabel ?? "");
  if (labelCmp !== 0) return labelCmp;
  return a.horizon - b.horizon;
}

export async function listForecasts(ctx: TenantContext, input: ForecastListInput): Promise<ForecastRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("forecasts")
    .select(
      "series_key, kind, class_section_id, unit, model, horizon, period_start, period_label, point, lower, upper, confidence, as_of, forecast_backtests(mape, n_train, holdout), class_sections(name, grades(code))",
    )
    .eq("institution_id", ctx.institution.id);
  if (input.kind) query = query.eq("kind", input.kind);
  if (input.classSectionId) query = query.eq("class_section_id", input.classSectionId);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as unknown as ListRow[];

  return rows
    .map((row) => {
      const backtest = row.forecast_backtests;
      const section = row.class_sections;
      return {
        seriesKey: row.series_key,
        kind: row.kind,
        classSectionId: row.class_section_id,
        sectionLabel: section ? `${section.grades?.code ?? "?"}-${section.name}` : null,
        unit: row.unit,
        model: row.model,
        horizon: row.horizon,
        periodStart: row.period_start,
        periodLabel: row.period_label,
        point: Number(row.point),
        lower: Number(row.lower),
        upper: Number(row.upper),
        confidence: Number(row.confidence),
        mape: Number(backtest?.mape ?? 0),
        nTrain: backtest?.n_train ?? 0,
        holdout: backtest?.holdout ?? [],
        asOf: row.as_of,
      };
    })
    .sort(byListOrder);
}
