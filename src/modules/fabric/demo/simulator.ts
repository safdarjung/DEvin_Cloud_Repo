// Scenario simulator — pure, explicit linear model over BASELINE_FACTS.
// No DB, no AI: a human-auditable formula set per docs/planning/fabric 06 §F-BE-11.
// Money is integer paise throughout.
import type { Scenario, ScenarioAssumptions, ScenarioResults } from "@/modules/fabric/types";
import { rng, type FixtureOpts } from "@/modules/fabric/demo/prng";

export interface BaselineFacts {
  students: number;
  avg_fee_paise_month: number;
  teachers: number;
  cost_paise_month: number; // salaries + fixed, at baseline enrolment
  rooms: number;
  periods_per_day: number;
  max_students_per_room: number;
}

// salaries ≈ 65% of baseline revenue; fixed = remainder of baseline cost.
const BASELINE_REVENUE_PAISE_MONTH = 1800 * 240000;
const BASELINE_SALARIES_PAISE_MONTH = Math.round(BASELINE_REVENUE_PAISE_MONTH * 0.65);
const BASELINE_FIXED_PAISE_MONTH = Math.round(BASELINE_REVENUE_PAISE_MONTH * 0.8) - BASELINE_SALARIES_PAISE_MONTH;

export const BASELINE_FACTS: BaselineFacts = {
  students: 1800,
  avg_fee_paise_month: 240000,
  teachers: 95,
  cost_paise_month: BASELINE_SALARIES_PAISE_MONTH + BASELINE_FIXED_PAISE_MONTH,
  rooms: 60,
  periods_per_day: 8,
  max_students_per_room: 40,
};

const RISK_UTILISATION_PCT = 95;
const RISK_LOAD_HOURS = 28;
const RISK_MARGIN_PCT = 5;
const CONFIDENCE_WIDEN_PER_MONTH_PCT = 2;
const COLLECTION_RATE_DROP_PER_5PCT_FEE = 1;
const BASE_COLLECTION_RATE_PCT = 97;

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsFrom(start: string, count: number): string[] {
  const out: string[] = [start];
  for (let i = 1; i < count; i++) out.push(nextMonth(out[i - 1]!));
  return out;
}

/**
 * Model (all explicit, no hidden state):
 * - students = base.students × (1 + enrolment_delta_pct/100)
 * - collection_rate_pct = 97 − 1pt per 5% of fee_change_pct (floor 50)
 * - revenue = students × avg_fee × (1 + fee_change_pct/100) × collection_rate_pct/100
 * - cost = (salaries × (teachers + staff_delta)/teachers + fixed) × (1 + cost_change_pct/100)
 * - capacity_utilisation_pct = students / (rooms × max_students_per_room) × 100
 * - teacher_load_hours = (students / max_students_per_room) × periods_per_day / (teachers + staff_delta)
 * - confidence band = ±(5 + 2×monthIndex) pct, widening with horizon
 * - risk_flags: utilisation>95, load>28h, margin<5%
 */
export function runScenario(a: ScenarioAssumptions, facts: BaselineFacts = BASELINE_FACTS): ScenarioResults {
  const months = monthsFrom("2026-11", a.horizon_months);
  const students = Math.round(facts.students * (1 + a.enrolment_delta_pct / 100));
  const staff = facts.teachers + a.staff_delta;

  const collectionRatePct = Math.max(
    50,
    BASE_COLLECTION_RATE_PCT - (Math.abs(a.fee_change_pct) / 5) * COLLECTION_RATE_DROP_PER_5PCT_FEE,
  );
  const revenueMonth = Math.round(
    students * facts.avg_fee_paise_month * (1 + a.fee_change_pct / 100) * (collectionRatePct / 100),
  );
  // Split the caller's own baseline cost (not the demo constants), so a real school's header and 12-month cost agree.
  const salariesMonth = facts.cost_paise_month * (BASELINE_SALARIES_PAISE_MONTH / (BASELINE_SALARIES_PAISE_MONTH + BASELINE_FIXED_PAISE_MONTH));
  const costMonth = Math.round(
    (salariesMonth * (staff / facts.teachers) + (facts.cost_paise_month - salariesMonth)) *
      (1 + a.cost_change_pct / 100),
  );
  const capacityUtilisationPct = Math.round(
    (students / (facts.rooms * facts.max_students_per_room)) * 100 * 10,
  ) / 10;
  const teacherLoadHours = Math.round(
    ((students / facts.max_students_per_room) * a.periods_per_day) / staff * 10,
  ) / 10;
  const marginPct = revenueMonth > 0 ? ((revenueMonth - costMonth) / revenueMonth) * 100 : -100;

  const riskFlags: string[] = [];
  if (capacityUtilisationPct > RISK_UTILISATION_PCT) riskFlags.push("capacity_utilisation_over_95pct");
  if (teacherLoadHours > RISK_LOAD_HOURS) riskFlags.push("teacher_load_over_28h");
  if (marginPct < RISK_MARGIN_PCT) riskFlags.push("margin_under_5pct");

  const revenue_paise: number[] = [];
  const cost_paise: number[] = [];
  const capacity_utilisation_pct: number[] = [];
  const teacher_load_hours: number[] = [];
  for (let i = 0; i < months.length; i++) {
    revenue_paise.push(revenueMonth);
    cost_paise.push(costMonth);
    capacity_utilisation_pct.push(capacityUtilisationPct);
    teacher_load_hours.push(teacherLoadHours);
  }

  const bandAtHorizon = 5 + CONFIDENCE_WIDEN_PER_MONTH_PCT * (a.horizon_months - 1);

  return {
    months,
    revenue_paise,
    cost_paise,
    capacity_utilisation_pct,
    teacher_load_hours,
    risk_flags: riskFlags,
    confidence_low_pct: Math.max(0, 100 - bandAtHorizon),
    confidence_high_pct: Math.min(100, 100 + bandAtHorizon),
  };
}

const SENSITIVITY_PARAMS: (keyof ScenarioAssumptions)[] = [
  "enrolment_delta_pct",
  "staff_delta",
  "fee_change_pct",
  "cost_change_pct",
  "periods_per_day",
  "horizon_months",
];

export interface SensitivityRow {
  param: keyof ScenarioAssumptions;
  revenue_delta_pct: number;
  cost_delta_pct: number;
}

/** ±10% one-at-a-time perturbation of each assumption, vs the base scenario's month-0 revenue/cost. */
export function sensitivity(a: ScenarioAssumptions, facts: BaselineFacts = BASELINE_FACTS): SensitivityRow[] {
  const base = runScenario(a, facts);
  const baseRevenue = base.revenue_paise[0] ?? 0;
  const baseCost = base.cost_paise[0] ?? 0;

  return SENSITIVITY_PARAMS.map((param) => {
    const delta = a[param] === 0 ? 1 : Math.abs(a[param]) * 0.1;
    const bumped: ScenarioAssumptions = { ...a, [param]: a[param] + delta };
    const result = runScenario(bumped, facts);
    const revenue = result.revenue_paise[0] ?? 0;
    const cost = result.cost_paise[0] ?? 0;
    return {
      param,
      revenue_delta_pct: baseRevenue !== 0 ? Math.round(((revenue - baseRevenue) / baseRevenue) * 1000) / 10 : 0,
      cost_delta_pct: baseCost !== 0 ? Math.round(((cost - baseCost) / baseCost) * 1000) / 10 : 0,
    };
  });
}

const BASELINE_ASSUMPTIONS: ScenarioAssumptions = {
  enrolment_delta_pct: 0,
  staff_delta: 0,
  fee_change_pct: 0,
  cost_change_pct: 0,
  periods_per_day: BASELINE_FACTS.periods_per_day,
  horizon_months: 12,
};

interface SavedScenarioDef {
  name: string;
  status: "draft" | "proposed" | "approved" | "rejected";
  rationale: string;
  assumptions: ScenarioAssumptions;
}

const SAVED_SCENARIOS: SavedScenarioDef[] = [
  {
    name: "New wing, +10% enrolment",
    status: "draft",
    rationale: "Model demand if the new wing opens next term.",
    assumptions: { ...BASELINE_ASSUMPTIONS, enrolment_delta_pct: 10, staff_delta: 3 },
  },
  {
    name: "Fee hike 8%, hold staff",
    status: "proposed",
    rationale: "Offset cost inflation without hiring.",
    assumptions: { ...BASELINE_ASSUMPTIONS, fee_change_pct: 8, cost_change_pct: 4 },
  },
  {
    name: "Add 5 teachers, no fee change",
    status: "approved",
    rationale: "Reduce teacher load ahead of board exams.",
    assumptions: { ...BASELINE_ASSUMPTIONS, staff_delta: 5, cost_change_pct: 3 },
  },
  {
    name: "Aggressive 20% enrolment, no new staff",
    status: "rejected",
    rationale: "Rejected: overloads teachers and rooms.",
    assumptions: { ...BASELINE_ASSUMPTIONS, enrolment_delta_pct: 20, horizon_months: 18 },
  },
];

/** Baseline (is_baseline, approved) + 4 saved scenarios, results computed by runScenario. */
export function scenarios(opts: FixtureOpts): Scenario[] {
  const r = rng(opts.seed ?? 7);
  const createdBy = "fixture-principal";
  const rows: Scenario[] = [
    {
      id: r.id("scenario", 0),
      institution_id: opts.institutionId,
      created_at: opts.now.toISOString(),
      updated_at: opts.now.toISOString(),
      name: "Baseline",
      status: "approved",
      is_baseline: true,
      assumptions: BASELINE_ASSUMPTIONS,
      results: runScenario(BASELINE_ASSUMPTIONS),
      rationale: "Current enrolment, staffing and fee structure, no change.",
      created_by: createdBy,
    },
  ];

  SAVED_SCENARIOS.forEach((def, i) => {
    rows.push({
      id: r.id("scenario", i + 1),
      institution_id: opts.institutionId,
      created_at: opts.now.toISOString(),
      updated_at: opts.now.toISOString(),
      name: def.name,
      status: def.status,
      is_baseline: false,
      assumptions: def.assumptions,
      results: runScenario(def.assumptions),
      rationale: def.rationale,
      created_by: createdBy,
    });
  });

  return rows;
}
